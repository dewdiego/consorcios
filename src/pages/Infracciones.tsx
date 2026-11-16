import { useEffect, useState } from 'react';
import { Gavel, Plus, Send, Settings2, ShieldAlert, Trash2 } from 'lucide-react';
import { supabase, type Falta, type Infraccion, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { fmtDate, fmtMoney, hoyISO } from '@/lib/engine';
import { encolarAviso, mailHtml, ufTxt } from '@/lib/avisos';
import { escHtml } from '@/lib/imprimir';
import { PORTAL_URL } from '@/lib/config';

const ESTADOS: Record<Infraccion['estado'], { label: string; color: 'slate' | 'blue' | 'amber' | 'red' | 'green' }> = {
  cargada: { label: 'CARGADA', color: 'slate' }, notificada: { label: 'NOTIFICADA', color: 'blue' }, en_revision: { label: 'CON DESCARGO', color: 'amber' },
  confirmada: { label: 'CONFIRMADA', color: 'red' }, descartada: { label: 'DESCARTADA', color: 'green' },
};
const masDias = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Infracciones: multas y apercibimientos por unidad, con notificación, descargo del propietario y resolución. */
export function Infracciones() {
  const { consorcio, usuario } = useApp();
  const [items, setItems] = useState<Infraccion[]>([]);
  const [faltas, setFaltas] = useState<Falta[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState(false);
  const [faltasModal, setFaltasModal] = useState(false);
  const [resolver, setResolver] = useState<Infraccion | null>(null);
  const [resolucion, setResolucion] = useState('');
  const vacio = { unidad_id: '', falta_id: '', tipo: 'multa', descripcion: '', monto: '', fecha: hoyISO(), vence_descargo: masDias(10) };
  const [form, setForm] = useState(vacio);
  const faltaVacia = { categoria: '', nombre: '', severidad: 'leve', nota: '', monto: '', monto_max: '', dias_descargo: '10' };
  const [ff, setFf] = useState(faltaVacia);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    // Sin descargo y con el plazo vencido: pasan solas a confirmadas
    const { data: venc } = await supabase.from('infracciones').select('*').eq('consorcio_id', consorcio.id).eq('estado', 'notificada').lt('vence_descargo', hoyISO());
    for (const i of (venc as Infraccion[]) || []) await confirmar(i, 'Confirmada por vencimiento del plazo de descargo.', false);
    const [i, f, u] = await Promise.all([
      supabase.from('infracciones').select('*, unidades(*), faltas(*)').eq('consorcio_id', consorcio.id).order('fecha', { ascending: false }),
      supabase.from('faltas').select('*').order('categoria').order('nombre'),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true).order('uf'),
    ]);
    setItems((i.data as Infraccion[]) || []); setFaltas((f.data as Falta[]) || []); setUnidades((u.data as Unidad[]) || []); setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  /** Confirma la infracción; si es multa con monto, genera el cargo a la unidad para la próxima expensa. */
  async function confirmar(i: Infraccion, texto: string, recargar = true) {
    await supabase.from('infracciones').update({ estado: 'confirmada', resolucion: texto || null }).eq('id', i.id);
    if (i.tipo === 'multa' && Number(i.monto) > 0) {
      const { count } = await supabase.from('ajustes_unidad').select('id', { count: 'exact', head: true }).eq('origen', 'infraccion').eq('origen_id', i.id);
      if (!count) await supabase.from('ajustes_unidad').insert({ consorcio_id: i.consorcio_id, unidad_id: i.unidad_id, tipo: 'multa', concepto: `Multa: ${i.descripcion}`.slice(0, 200), monto: i.monto, origen: 'infraccion', origen_id: i.id, creado_por: usuario });
    }
    if (recargar) load();
  }
  const descartar = async (i: Infraccion, texto: string) => {
    await supabase.from('infracciones').update({ estado: 'descartada', resolucion: texto || null }).eq('id', i.id);
    await supabase.from('ajustes_unidad').delete().eq('origen', 'infraccion').eq('origen_id', i.id).is('liquidacion_id', null);
    load();
  };

  const elegirFalta = (id: string) => {
    const f = faltas.find((x) => x.id === id);
    setForm({ ...form, falta_id: id, descripcion: form.descripcion || f?.nombre || '', monto: f ? String(f.monto || '') : form.monto, vence_descargo: f ? masDias(f.dias_descargo) : form.vence_descargo });
  };
  const guardar = async () => {
    if (!consorcio || !form.unidad_id || !form.descripcion.trim()) return setMsg('Elegí la unidad y describí la infracción.');
    const { error } = await supabase.from('infracciones').insert({ consorcio_id: consorcio.id, unidad_id: form.unidad_id, falta_id: form.falta_id || null, tipo: form.tipo, descripcion: form.descripcion.trim(), monto: form.tipo === 'multa' ? parseFloat(form.monto) || 0 : 0, fecha: form.fecha, vence_descargo: form.vence_descargo || null });
    if (error) return setMsg(error.message);
    setModal(false); setForm(vacio); setMsg(''); load();
  };
  const notificar = async (i: Infraccion) => {
    if (!consorcio || !i.unidades) return;
    const cuerpo = `<p>Se registró ${i.tipo === 'multa' ? 'una <b>multa</b>' : 'un <b>apercibimiento</b>'} para su unidad:</p>
      <p style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:8px">${escHtml(i.descripcion)}</p>
      ${i.faltas?.nota ? `<p style="color:#64748b">${escHtml(i.faltas.nota)}</p>` : ''}
      ${Number(i.monto) > 0 ? `<p>Importe: <b>${fmtMoney(i.monto)}</b> (se incluye en la próxima expensa si queda confirmada).</p>` : ''}
      <p>Puede presentar su <b>descargo</b> desde el portal${i.vence_descargo ? ` hasta el <b>${fmtDate(i.vence_descargo)}</b>` : ''}. Pasado ese plazo queda confirmada.</p>`;
    try {
      const n = await encolarAviso(consorcio, [i.unidades], `${i.tipo === 'multa' ? 'Multa' : 'Apercibimiento'} - ${ufTxt(i.unidades)} - ${consorcio.nombre}`, mailHtml(i.tipo === 'multa' ? 'Notificación de multa' : 'Apercibimiento', `${consorcio.nombre} · ${ufTxt(i.unidades)}`, cuerpo, { texto: 'Entrar al portal', url: PORTAL_URL }), `${i.tipo === 'multa' ? 'Multa' : 'Apercibimiento'}: ${i.descripcion}`);
      await supabase.from('infracciones').update({ estado: i.estado === 'cargada' ? 'notificada' : i.estado, notificada_at: new Date().toISOString() }).eq('id', i.id);
      setMsg(n ? 'Notificación encolada (sale con el próximo procesamiento de Envíos de mail).' : 'La unidad no tiene mail cargado: quedó marcada como notificada, avisale por otro medio.');
      load();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const guardarFalta = async () => {
    if (!ff.nombre.trim()) return;
    await supabase.from('faltas').insert({ categoria: ff.categoria || null, nombre: ff.nombre.trim(), severidad: ff.severidad, nota: ff.nota || null, monto: parseFloat(ff.monto) || 0, monto_max: ff.monto_max ? parseFloat(ff.monto_max) : null, monto_fijo: !ff.monto_max, dias_descargo: parseInt(ff.dias_descargo) || 10 });
    setFf(faltaVacia); load();
  };

  if (!consorcio) return null;
  return (
    <div>
      <PageHeader title={`Infracciones · ${consorcio.nombre}`} subtitle="Multas y apercibimientos por unidad. La multa confirmada se cobra sola en la próxima expensa."
        action={<div className="flex gap-2"><Button variant="secondary" onClick={() => setFaltasModal(true)}><Settings2 size={15} /> Faltas</Button><Button onClick={() => { setMsg(''); setModal(true); }}><Plus size={16} /> Nueva</Button></div>} />
      {msg && <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 mb-4">{msg}</p>}
      {loading ? <Spinner /> : items.length === 0 ? <Card><EmptyState icon={<ShieldAlert size={28} />} title="Sin infracciones" subtitle="Primero cargá los tipos de falta (botón Faltas) y después registrá la infracción." /></Card> : (
        <Card><Table headers={['Fecha', 'Unidad', 'Tipo', 'Descripción', 'Monto', 'Descargo hasta', 'Estado', '']}>
          {items.map((i) => (
            <tr key={i.id} className="hover:bg-slate-50 align-top">
              <Td>{fmtDate(i.fecha)}</Td><Td className="font-medium">{ufTxt(i.unidades)}</Td><Td>{i.tipo === 'multa' ? 'Multa' : 'Apercibimiento'}</Td>
              <Td className="text-slate-600 max-w-sm">{i.descripcion}{i.descargo && <span className="block text-xs text-amber-700 mt-1">Descargo: "{i.descargo}"</span>}{i.resolucion && <span className="block text-xs text-slate-400 mt-1">{i.resolucion}</span>}</Td>
              <Td className="text-right">{Number(i.monto) ? fmtMoney(i.monto) : '—'}</Td><Td>{fmtDate(i.vence_descargo)}</Td>
              <Td><Badge color={ESTADOS[i.estado].color}>{ESTADOS[i.estado].label}</Badge></Td>
              <Td><div className="flex gap-1 flex-wrap">
                {(i.estado === 'cargada' || i.estado === 'notificada') && <Button size="sm" variant="secondary" onClick={() => notificar(i)}><Send size={13} /> {i.estado === 'cargada' ? 'Notificar' : 'Reenviar'}</Button>}
                {i.estado !== 'confirmada' && i.estado !== 'descartada' && <Button size="sm" onClick={() => { setResolucion(''); setResolver(i); }}><Gavel size={13} /> Resolver</Button>}
                {i.estado === 'cargada' && <button title="Eliminar" onClick={async () => { await supabase.from('infracciones').delete().eq('id', i.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>}
              </div></Td>
            </tr>
          ))}
        </Table></Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Nueva infracción">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Unidad" required value={form.unidad_id} onChange={(v) => setForm({ ...form, unidad_id: v })} placeholder="— Elegir —" options={unidades.map((u) => ({ value: u.id, label: `${ufTxt(u)} · ${u.propietario || ''}` }))} />
          <Select label="Falta" value={form.falta_id} onChange={elegirFalta} placeholder="— Sin tipificar —" options={faltas.map((f) => ({ value: f.id, label: `${f.categoria ? `${f.categoria} · ` : ''}${f.nombre}` }))} />
          <Select label="Tipo" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })} options={[{ value: 'multa', label: 'Multa' }, { value: 'apercibimiento', label: 'Apercibimiento (sin costo)' }]} />
          {form.tipo === 'multa' ? <Input label="Monto" type="number" step="0.01" value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} /> : <div />}
          <Input label="Fecha del hecho" type="date" value={form.fecha} onChange={(v) => setForm({ ...form, fecha: v })} />
          <Input label="Descargo hasta" type="date" value={form.vence_descargo} onChange={(v) => setForm({ ...form, vence_descargo: v })} />
          <div className="sm:col-span-2"><Textarea label="Descripción" required value={form.descripcion} onChange={(v) => setForm({ ...form, descripcion: v })} rows={3} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></div>
      </Modal>

      <Modal open={!!resolver} onClose={() => setResolver(null)} title="Resolver infracción">
        {resolver && <>
          <p className="text-sm text-slate-600 mb-2"><b>{ufTxt(resolver.unidades)}</b> · {resolver.descripcion}</p>
          {resolver.descargo ? <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">Descargo del propietario ({fmtDate(resolver.descargo_at)}): "{resolver.descargo}"</p> : <p className="text-sm text-slate-400 mb-3">El propietario no presentó descargo.</p>}
          <Textarea label="Fundamento de la decisión" value={resolucion} onChange={setResolucion} rows={2} />
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="secondary" onClick={() => { descartar(resolver, resolucion); setResolver(null); }}>Descartar infracción</Button>
            <Button variant="danger" onClick={() => { confirmar(resolver, resolucion); setResolver(null); }}>Confirmar{resolver.tipo === 'multa' && Number(resolver.monto) > 0 ? ` y cobrar ${fmtMoney(resolver.monto)}` : ''}</Button>
          </div>
        </>}
      </Modal>

      <Modal open={faltasModal} onClose={() => setFaltasModal(false)} title="Tipos de falta" size="lg">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <Input label="Categoría" value={ff.categoria} onChange={(v) => setFf({ ...ff, categoria: v })} placeholder="Ruidos, mascotas…" />
          <div className="col-span-2"><Input label="Nombre" value={ff.nombre} onChange={(v) => setFf({ ...ff, nombre: v })} /></div>
          <Select label="Severidad" value={ff.severidad} onChange={(v) => setFf({ ...ff, severidad: v })} options={[{ value: 'leve', label: 'Leve' }, { value: 'media', label: 'Media' }, { value: 'grave', label: 'Grave' }]} />
          <Input label="Monto" type="number" value={ff.monto} onChange={(v) => setFf({ ...ff, monto: v })} />
          <Input label="Máximo (si es variable)" type="number" value={ff.monto_max} onChange={(v) => setFf({ ...ff, monto_max: v })} />
          <Input label="Días para descargo" type="number" value={ff.dias_descargo} onChange={(v) => setFf({ ...ff, dias_descargo: v })} />
          <Button onClick={guardarFalta}><Plus size={15} /> Agregar</Button>
          <div className="col-span-2 sm:col-span-4"><Input label="Referencia al reglamento (sale en la notificación)" value={ff.nota} onChange={(v) => setFf({ ...ff, nota: v })} /></div>
        </div>
        <div className="mt-4 max-h-64 overflow-y-auto">
          {faltas.length === 0 ? <p className="text-sm text-slate-400">Todavía no hay faltas cargadas.</p> : <Table headers={['Categoría', 'Falta', 'Severidad', 'Monto', 'Descargo', '']}>
            {faltas.map((f) => <tr key={f.id}><Td>{f.categoria || '—'}</Td><Td className="font-medium">{f.nombre}</Td><Td>{f.severidad}</Td><Td>{fmtMoney(f.monto)}{f.monto_max ? ` a ${fmtMoney(f.monto_max)}` : ''}</Td><Td>{f.dias_descargo} días</Td>
              <Td><button title="Eliminar" onClick={async () => { await supabase.from('faltas').delete().eq('id', f.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td></tr>)}
          </Table>}
        </div>
      </Modal>
    </div>
  );
}

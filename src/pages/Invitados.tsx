import { useEffect, useState } from 'react';
import { DoorOpen, LogIn, LogOut, Pencil, Plus, Trash2, UserCheck } from 'lucide-react';
import { supabase, type Acceso, type Invitado, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td } from '@/components/ui';
import { fmtDate, hoyISO } from '@/lib/engine';
import { ufTxt } from '@/lib/avisos';

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');

/** Invitados autorizados por unidad y registro de entradas y salidas (guardia / portería). */
export function Invitados() {
  const { consorcio } = useApp();
  const [tab, setTab] = useState('accesos');
  const [invitados, setInvitados] = useState<Invitado[]>([]);
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [buscar, setBuscar] = useState('');
  const vacio = { id: '', nombre: '', documento: '', patente: '', vehiculo: '', email: '', unidad_id: '', desde: hoyISO(), hasta: '' };
  const [form, setForm] = useState<typeof vacio | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [i, a, u] = await Promise.all([
      supabase.from('invitados').select('*, unidades(*)').eq('consorcio_id', consorcio.id).order('nombre'),
      supabase.from('accesos').select('*, invitados(*, unidades(*))').eq('consorcio_id', consorcio.id).order('entrada', { ascending: false }).limit(200),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true).order('uf'),
    ]);
    setInvitados((i.data as Invitado[]) || []); setAccesos((a.data as Acceso[]) || []); setUnidades((u.data as Unidad[]) || []); setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const vigente = (i: Invitado) => i.activo && i.desde <= hoyISO() && (!i.hasta || i.hasta >= hoyISO());
  const adentro = (i: Invitado) => accesos.find((a) => a.invitado_id === i.id && !a.salida);
  const guardar = async () => {
    if (!consorcio || !form || !form.nombre.trim()) return;
    const fila = { consorcio_id: consorcio.id, nombre: form.nombre.trim(), documento: form.documento || null, patente: form.patente.toUpperCase().replace(/\s/g, '') || null, vehiculo: form.vehiculo || null, email: form.email || null, unidad_id: form.unidad_id || null, desde: form.desde, hasta: form.hasta || null };
    if (form.id) await supabase.from('invitados').update(fila).eq('id', form.id); else await supabase.from('invitados').insert(fila);
    setForm(null); load();
  };
  const entrada = async (i: Invitado) => { await supabase.from('accesos').insert({ consorcio_id: i.consorcio_id, invitado_id: i.id }); load(); };
  const salida = async (a: Acceso) => { await supabase.from('accesos').update({ salida: new Date().toISOString() }).eq('id', a.id); load(); };

  if (!consorcio) return null;
  const q = buscar.trim().toLowerCase();
  const filtrados = invitados.filter((i) => !q || [i.nombre, i.documento, i.patente].some((x) => (x || '').toLowerCase().includes(q)));
  return (
    <div>
      <PageHeader title={`Invitados y accesos · ${consorcio.nombre}`} subtitle="Personas autorizadas por cada unidad y control de entradas y salidas"
        action={<Button onClick={() => setForm(vacio)}><Plus size={16} /> Nuevo invitado</Button>} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'accesos', label: 'Control de acceso' }, { key: 'historial', label: 'Historial', badge: accesos.length || undefined }]} />
      {loading ? <Spinner /> : tab === 'accesos' ? (
        <>
          <div className="max-w-sm mb-3"><Input value={buscar} onChange={setBuscar} placeholder="Buscar por nombre, documento o patente" /></div>
          {filtrados.length === 0 ? <Card><EmptyState icon={<UserCheck size={28} />} title="Sin invitados" subtitle="Cargá las personas autorizadas a ingresar, con su vigencia." /></Card> : (
            <Card><Table headers={['Invitado', 'Documento', 'Vehículo', 'Unidad', 'Vigencia', 'Estado', '']}>
              {filtrados.map((i) => {
                const a = adentro(i);
                return (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <Td className="font-medium">{i.nombre}</Td><Td>{i.documento || '—'}</Td><Td>{[i.patente, i.vehiculo].filter(Boolean).join(' · ') || '—'}</Td><Td>{ufTxt(i.unidades)}</Td>
                    <Td className="text-slate-500">{fmtDate(i.desde)}{i.hasta ? ` al ${fmtDate(i.hasta)}` : ' sin vencimiento'}</Td>
                    <Td>{a ? <Badge color="blue">ADENTRO desde {hora(a.entrada)}</Badge> : vigente(i) ? <Badge color="green">AUTORIZADO</Badge> : <Badge color="red">NO VIGENTE</Badge>}</Td>
                    <Td><div className="flex gap-1">
                      {a ? <Button size="sm" variant="secondary" onClick={() => salida(a)}><LogOut size={13} /> Salida</Button> : vigente(i) && <Button size="sm" onClick={() => entrada(i)}><LogIn size={13} /> Entrada</Button>}
                      <button title="Editar" onClick={() => setForm({ id: i.id, nombre: i.nombre, documento: i.documento || '', patente: i.patente || '', vehiculo: i.vehiculo || '', email: i.email || '', unidad_id: i.unidad_id || '', desde: i.desde, hasta: i.hasta || '' })} className="p-1.5 rounded text-slate-500 hover:bg-slate-100"><Pencil size={14} /></button>
                      <button title={i.activo ? 'Desactivar' : 'Activar'} onClick={async () => { await supabase.from('invitados').update({ activo: !i.activo }).eq('id', i.id); load(); }} className="p-1.5 rounded text-slate-500 hover:bg-slate-100"><DoorOpen size={14} /></button>
                      <button title="Eliminar" onClick={async () => { await supabase.from('invitados').delete().eq('id', i.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div></Td>
                  </tr>
                );
              })}
            </Table></Card>
          )}
        </>
      ) : accesos.length === 0 ? <Card><EmptyState icon={<DoorOpen size={28} />} title="Sin movimientos" subtitle="Cada entrada y salida queda registrada acá." /></Card> : (
        <Card><Table headers={['Entrada', 'Salida', 'Invitado', 'Documento', 'Patente', 'Unidad']}>
          {accesos.map((a) => <tr key={a.id}><Td>{hora(a.entrada)}</Td><Td>{a.salida ? hora(a.salida) : <Badge color="blue">ADENTRO</Badge>}</Td><Td className="font-medium">{a.invitados?.nombre}</Td><Td>{a.invitados?.documento || '—'}</Td><Td>{a.invitados?.patente || '—'}</Td><Td>{ufTxt(a.invitados?.unidades)}</Td></tr>)}
        </Table></Card>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar invitado' : 'Nuevo invitado'}>
        {form && <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Nombre y apellido" required value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} />
            <Input label="Documento" value={form.documento} onChange={(v) => setForm({ ...form, documento: v })} />
            <Input label="Patente" value={form.patente} onChange={(v) => setForm({ ...form, patente: v })} />
            <Input label="Vehículo" value={form.vehiculo} onChange={(v) => setForm({ ...form, vehiculo: v })} placeholder="Marca, modelo, color" />
            <Select label="Unidad que lo autoriza" value={form.unidad_id} onChange={(v) => setForm({ ...form, unidad_id: v })} placeholder="— Elegir —" options={unidades.map((u) => ({ value: u.id, label: `${ufTxt(u)} · ${u.propietario || ''}` }))} />
            <Input label="Mail (opcional)" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <Input label="Válido desde" type="date" value={form.desde} onChange={(v) => setForm({ ...form, desde: v })} />
            <Input label="Válido hasta (vacío = sin vencimiento)" type="date" value={form.hasta} onChange={(v) => setForm({ ...form, hasta: v })} />
          </div>
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></div>
        </>}
      </Modal>
    </div>
  );
}

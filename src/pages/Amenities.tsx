import { useEffect, useState } from 'react';
import { CalendarCheck, Pencil, Plus, Trash2, X } from 'lucide-react';
import { supabase, type Amenity, type HorarioAmenity, type Reserva, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea } from '@/components/ui';
import { fmtDate, fmtMoney, hoyISO } from '@/lib/engine';
import { ufTxt } from '@/lib/avisos';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const diaDe = (fecha: string) => new Date(`${fecha}T12:00:00`).getDay();

/** Amenities del consorcio (SUM, parrilla, pileta, cancha) con sus horarios, límites y reservas. */
export function Amenities() {
  const { consorcio, usuario } = useApp();
  const [tab, setTab] = useState('reservas');
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const vacio = { id: '', nombre: '', mensaje: '', reservable: true, max_dia: '1', max_semana: '2', max_mes: '4', dias_anticipacion: '30', dias_cancelacion: '1', costo: '0', horarios: [] as HorarioAmenity[] };
  const [form, setForm] = useState<typeof vacio | null>(null);
  const [h, setH] = useState({ dias: [6, 0] as number[], desde: '12:00', hasta: '16:00', cupo: '1' });
  const [nueva, setNueva] = useState<{ amenity_id: string; unidad_id: string; fecha: string; turno: string } | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [a, r, u] = await Promise.all([
      supabase.from('amenities').select('*').eq('consorcio_id', consorcio.id).order('nombre'),
      supabase.from('reservas').select('*, unidades(*), amenities(*)').eq('consorcio_id', consorcio.id).gte('fecha', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).order('fecha').order('desde'),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true).order('uf'),
    ]);
    setAmenities((a.data as Amenity[]) || []); setReservas((r.data as Reserva[]) || []); setUnidades((u.data as Unidad[]) || []); setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const guardar = async () => {
    if (!consorcio || !form || !form.nombre.trim()) return;
    const fila = { consorcio_id: consorcio.id, nombre: form.nombre.trim(), mensaje: form.mensaje || null, reservable: form.reservable, max_dia: parseInt(form.max_dia) || 1, max_semana: parseInt(form.max_semana) || 1, max_mes: parseInt(form.max_mes) || 1, dias_anticipacion: parseInt(form.dias_anticipacion) || 0, dias_cancelacion: parseInt(form.dias_cancelacion) || 0, costo: parseFloat(form.costo) || 0, horarios: form.horarios };
    const { error } = form.id ? await supabase.from('amenities').update(fila).eq('id', form.id) : await supabase.from('amenities').insert(fila);
    if (error) return setMsg(error.message);
    setForm(null); load();
  };
  const agregarHorarios = () => {
    if (!form || h.desde >= h.hasta) return;
    const nuevos = h.dias.map((dia) => ({ dia, desde: h.desde, hasta: h.hasta, cupo: parseInt(h.cupo) || 1 }));
    const todos = [...form.horarios.filter((x) => !nuevos.some((n) => n.dia === x.dia && n.desde === x.desde)), ...nuevos].sort((x, y) => x.dia - y.dia || x.desde.localeCompare(y.desde));
    setForm({ ...form, horarios: todos });
  };
  const turnosDe = (amenityId: string, fecha: string) => {
    const a = amenities.find((x) => x.id === amenityId); if (!a || !fecha) return [];
    return (a.horarios || []).filter((x) => x.dia === diaDe(fecha)).map((x) => ({ ...x, libres: x.cupo - reservas.filter((r) => r.amenity_id === a.id && r.fecha === fecha && r.desde === x.desde && r.estado === 'activa').length }));
  };
  const reservar = async () => {
    if (!consorcio || !nueva || !nueva.unidad_id || !nueva.turno) return setMsg('Elegí unidad y horario.');
    const a = amenities.find((x) => x.id === nueva.amenity_id)!; const [desde, hasta] = nueva.turno.split('|');
    const u = unidades.find((x) => x.id === nueva.unidad_id);
    const { data, error } = await supabase.from('reservas').insert({ amenity_id: a.id, consorcio_id: consorcio.id, unidad_id: nueva.unidad_id, fecha: nueva.fecha, desde, hasta, nombre: u?.propietario || null, costo: a.costo }).select().single();
    if (error) return setMsg(error.message);
    if (Number(a.costo) > 0) await supabase.from('ajustes_unidad').insert({ consorcio_id: consorcio.id, unidad_id: nueva.unidad_id, tipo: 'reserva', concepto: `Reserva ${a.nombre} ${fmtDate(nueva.fecha)} ${desde}`, monto: a.costo, origen: 'reserva', origen_id: data.id, creado_por: usuario });
    setNueva(null); setMsg(''); load();
  };
  const cancelar = async (r: Reserva) => {
    await supabase.from('reservas').update({ estado: 'cancelada' }).eq('id', r.id);
    await supabase.from('ajustes_unidad').delete().eq('origen', 'reserva').eq('origen_id', r.id).is('liquidacion_id', null);
    load();
  };

  if (!consorcio) return null;
  const proximas = reservas.filter((r) => r.fecha >= hoyISO() && r.estado === 'activa');
  return (
    <div>
      <PageHeader title={`Amenities y reservas · ${consorcio.nombre}`} subtitle="Los vecinos reservan desde el portal; el costo, si tiene, se cobra en la expensa"
        action={<div className="flex gap-2">
          {amenities.length > 0 && <Button variant="secondary" onClick={() => { setMsg(''); setNueva({ amenity_id: amenities[0].id, unidad_id: '', fecha: hoyISO(), turno: '' }); }}><CalendarCheck size={15} /> Reservar por un vecino</Button>}
          <Button onClick={() => setForm(vacio)}><Plus size={16} /> Nuevo amenity</Button>
        </div>} />
      {msg && <p className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 mb-4">{msg}</p>}
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'reservas', label: 'Reservas', badge: proximas.length || undefined }, { key: 'amenities', label: 'Amenities', badge: amenities.length || undefined }]} />
      {loading ? <Spinner /> : tab === 'amenities' ? (
        amenities.length === 0 ? <Card><EmptyState icon={<CalendarCheck size={28} />} title="Sin amenities" subtitle="Cargá el SUM, la parrilla o la pileta con sus horarios para habilitar las reservas." /></Card> : (
          <Card><Table headers={['Amenity', 'Horarios', 'Límites por unidad', 'Anticipación', 'Costo', '']}>
            {amenities.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50 align-top">
                <Td className="font-medium">{a.nombre}{!a.reservable && <Badge color="slate">NO RESERVABLE</Badge>}</Td>
                <Td className="text-slate-500 text-xs">{(a.horarios || []).length === 0 ? 'Sin horarios' : DIAS.map((d, i) => { const hs = a.horarios.filter((x) => x.dia === i); return hs.length ? <span key={i} className="block">{d}: {hs.map((x) => `${x.desde}-${x.hasta}`).join(', ')}</span> : null; })}</Td>
                <Td>{a.max_dia}/día · {a.max_semana}/semana · {a.max_mes}/mes</Td><Td>hasta {a.dias_anticipacion} días antes</Td><Td>{Number(a.costo) ? fmtMoney(a.costo) : 'Sin costo'}</Td>
                <Td><div className="flex gap-1">
                  <button title="Editar" onClick={() => setForm({ id: a.id, nombre: a.nombre, mensaje: a.mensaje || '', reservable: a.reservable, max_dia: String(a.max_dia), max_semana: String(a.max_semana), max_mes: String(a.max_mes), dias_anticipacion: String(a.dias_anticipacion), dias_cancelacion: String(a.dias_cancelacion), costo: String(a.costo), horarios: a.horarios || [] })} className="p-1.5 rounded text-slate-500 hover:bg-slate-100"><Pencil size={14} /></button>
                  <button title="Eliminar" onClick={async () => { await supabase.from('amenities').delete().eq('id', a.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                </div></Td>
              </tr>
            ))}
          </Table></Card>
        )
      ) : reservas.length === 0 ? <Card><EmptyState icon={<CalendarCheck size={28} />} title="Sin reservas" subtitle="Acá aparecen las reservas que hacen los vecinos desde el portal y las que cargues vos." /></Card> : (
        <Card><Table headers={['Fecha', 'Horario', 'Amenity', 'Unidad', 'Reservó', 'Costo', 'Estado', '']}>
          {[...reservas].reverse().map((r) => (
            <tr key={r.id} className={`hover:bg-slate-50 ${r.fecha < hoyISO() ? 'opacity-60' : ''}`}>
              <Td className="font-medium">{DIAS[diaDe(r.fecha)].slice(0, 3)} {fmtDate(r.fecha)}</Td><Td>{r.desde} a {r.hasta}</Td><Td>{r.amenities?.nombre}</Td><Td>{ufTxt(r.unidades)}</Td>
              <Td className="text-slate-500">{r.nombre || r.email || '—'}</Td><Td>{Number(r.costo) ? fmtMoney(r.costo) : '—'}</Td>
              <Td><Badge color={r.estado === 'activa' ? 'green' : 'slate'}>{r.estado.toUpperCase()}</Badge></Td>
              <Td>{r.estado === 'activa' && r.fecha >= hoyISO() && <Button size="sm" variant="secondary" onClick={() => cancelar(r)}><X size={13} /> Cancelar</Button>}</Td>
            </tr>
          ))}
        </Table></Card>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar amenity' : 'Nuevo amenity'} size="lg">
        {form && <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2"><Input label="Nombre" required value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} placeholder="SUM, Parrilla 1, Pileta…" /></div>
            <Input label="Costo por reserva" type="number" value={form.costo} onChange={(v) => setForm({ ...form, costo: v })} />
            <label className="flex items-center gap-2 text-sm text-slate-600 mt-7"><input type="checkbox" checked={form.reservable} onChange={(e) => setForm({ ...form, reservable: e.target.checked })} /> Se puede reservar</label>
            <Input label="Máx. por día" type="number" value={form.max_dia} onChange={(v) => setForm({ ...form, max_dia: v })} />
            <Input label="Máx. por semana" type="number" value={form.max_semana} onChange={(v) => setForm({ ...form, max_semana: v })} />
            <Input label="Máx. por mes" type="number" value={form.max_mes} onChange={(v) => setForm({ ...form, max_mes: v })} />
            <div />
            <div className="col-span-2"><Input label="Reservar hasta con (días de anticipación)" type="number" value={form.dias_anticipacion} onChange={(v) => setForm({ ...form, dias_anticipacion: v })} /></div>
            <div className="col-span-2"><Input label="Cancelar hasta (días antes)" type="number" value={form.dias_cancelacion} onChange={(v) => setForm({ ...form, dias_cancelacion: v })} /></div>
            <div className="col-span-2 sm:col-span-4"><Textarea label="Reglas de uso (las ve el vecino al reservar)" value={form.mensaje} onChange={(v) => setForm({ ...form, mensaje: v })} rows={2} /></div>
          </div>
          <p className="text-sm font-medium text-slate-600 mt-4 mb-2">Horarios de reserva</p>
          <div className="flex flex-wrap items-end gap-2 bg-slate-50 rounded-lg p-3">
            <div className="flex flex-wrap gap-1">{DIAS.map((d, i) => <button key={i} type="button" onClick={() => setH({ ...h, dias: h.dias.includes(i) ? h.dias.filter((x) => x !== i) : [...h.dias, i] })} className={`px-2 py-1 rounded text-xs border ${h.dias.includes(i) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-200'}`}>{d.slice(0, 3)}</button>)}</div>
            <div className="w-28"><Input label="Desde" type="time" value={h.desde} onChange={(v) => setH({ ...h, desde: v })} /></div>
            <div className="w-28"><Input label="Hasta" type="time" value={h.hasta} onChange={(v) => setH({ ...h, hasta: v })} /></div>
            <div className="w-20"><Input label="Cupo" type="number" value={h.cupo} onChange={(v) => setH({ ...h, cupo: v })} /></div>
            <Button variant="secondary" onClick={agregarHorarios}><Plus size={14} /> Agregar turno</Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">{form.horarios.map((x, i) => <span key={i} className="inline-flex items-center gap-1 text-xs bg-white border border-slate-200 rounded-full px-2 py-1">{DIAS[x.dia].slice(0, 3)} {x.desde}-{x.hasta}{x.cupo > 1 ? ` ×${x.cupo}` : ''}<button onClick={() => setForm({ ...form, horarios: form.horarios.filter((_, j) => j !== i) })} className="text-red-400"><X size={12} /></button></span>)}</div>
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></div>
        </>}
      </Modal>

      <Modal open={!!nueva} onClose={() => setNueva(null)} title="Reservar por un vecino">
        {nueva && <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Amenity" value={nueva.amenity_id} onChange={(v) => setNueva({ ...nueva, amenity_id: v, turno: '' })} options={amenities.map((a) => ({ value: a.id, label: a.nombre }))} />
            <Select label="Unidad" value={nueva.unidad_id} onChange={(v) => setNueva({ ...nueva, unidad_id: v })} placeholder="— Elegir —" options={unidades.map((u) => ({ value: u.id, label: `${ufTxt(u)} · ${u.propietario || ''}` }))} />
            <Input label="Fecha" type="date" value={nueva.fecha} onChange={(v) => setNueva({ ...nueva, fecha: v, turno: '' })} />
            <Select label="Horario" value={nueva.turno} onChange={(v) => setNueva({ ...nueva, turno: v })} placeholder={turnosDe(nueva.amenity_id, nueva.fecha).length ? '— Elegir —' : 'Sin horarios ese día'} options={turnosDe(nueva.amenity_id, nueva.fecha).filter((t) => t.libres > 0).map((t) => ({ value: `${t.desde}|${t.hasta}`, label: `${t.desde} a ${t.hasta}${t.cupo > 1 ? ` (quedan ${t.libres})` : ''}` }))} />
          </div>
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setNueva(null)}>Cancelar</Button><Button onClick={reservar}>Reservar</Button></div>
        </>}
      </Modal>
    </div>
  );
}

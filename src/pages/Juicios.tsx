import { useEffect, useState } from 'react';
import { Gavel, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase, type Juicio, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { fmtMoney } from '@/lib/engine';
import { ufTxt } from '@/lib/avisos';

/** Juicios del consorcio: los activos salen en la tabla "Datos de juicios" del resumen de expensas. */
export function Juicios() {
  const { consorcio } = useApp();
  const [items, setItems] = useState<Juicio[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true);
  const vacio = { id: '', caratula: '', expediente: '', juzgado: '', objeto: '', monto_reclamado: '', comentario: '', estado: 'activo', unidad_id: '' };
  const [form, setForm] = useState<typeof vacio | null>(null);
  const [err, setErr] = useState('');

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [j, u] = await Promise.all([
      supabase.from('juicios').select('*').eq('consorcio_id', consorcio.id).order('estado').order('created_at', { ascending: false }),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).order('uf'),
    ]);
    setItems((j.data as Juicio[]) || []); setUnidades((u.data as Unidad[]) || []); setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const guardar = async () => {
    if (!consorcio || !form) return;
    if (!form.caratula.trim()) return setErr('Completá la carátula.');
    const fila = { consorcio_id: consorcio.id, caratula: form.caratula.trim(), expediente: form.expediente || null, juzgado: form.juzgado || null, objeto: form.objeto || null, monto_reclamado: form.monto_reclamado ? parseFloat(form.monto_reclamado) : null, comentario: form.comentario || null, estado: form.estado, unidad_id: form.unidad_id || null };
    const { error } = form.id ? await supabase.from('juicios').update(fila).eq('id', form.id) : await supabase.from('juicios').insert(fila);
    if (error) return setErr(error.message);
    setForm(null); load();
  };
  const borrar = async (j: Juicio) => { await supabase.from('juicios').delete().eq('id', j.id); load(); };

  if (!consorcio) return null;
  return (
    <div>
      <PageHeader title={`Juicios · ${consorcio.nombre}`} subtitle="Los juicios activos se informan en cada expensa (Art. 10 inc. h Ley 941)"
        action={<Button onClick={() => { setErr(''); setForm(vacio); }}><Plus size={16} /> Nuevo juicio</Button>} />
      {loading ? <Spinner /> : items.length === 0 ? <Card><EmptyState icon={<Gavel size={28} />} title="Sin juicios cargados" subtitle='La expensa informa "No hay juicios vigentes".' /></Card> : (
        <Card><Table headers={['Carátula', 'Expediente', 'Juzgado', 'Objeto', 'Monto reclamado', 'Unidad', 'Estado', '']}>
          {items.map((j) => (
            <tr key={j.id} className="hover:bg-slate-50">
              <Td className="font-medium">{j.caratula}{j.comentario && <span className="block text-xs text-slate-400 font-normal">{j.comentario}</span>}</Td>
              <Td>{j.expediente || '—'}</Td><Td>{j.juzgado || '—'}</Td><Td className="text-slate-500">{j.objeto || '—'}</Td>
              <Td className="text-right">{j.monto_reclamado ? fmtMoney(j.monto_reclamado) : '—'}</Td>
              <Td>{j.unidad_id ? ufTxt(unidades.find((u) => u.id === j.unidad_id)) : '—'}</Td>
              <Td><Badge color={j.estado === 'activo' ? 'amber' : 'slate'}>{j.estado.toUpperCase()}</Badge></Td>
              <Td><div className="flex gap-1">
                <button title="Editar" onClick={() => { setErr(''); setForm({ id: j.id, caratula: j.caratula, expediente: j.expediente || '', juzgado: j.juzgado || '', objeto: j.objeto || '', monto_reclamado: j.monto_reclamado ? String(j.monto_reclamado) : '', comentario: j.comentario || '', estado: j.estado, unidad_id: j.unidad_id || '' }); }} className="p-1.5 rounded text-slate-500 hover:bg-slate-100"><Pencil size={14} /></button>
                <button title="Eliminar" onClick={() => borrar(j)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
              </div></Td>
            </tr>
          ))}
        </Table></Card>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar juicio' : 'Nuevo juicio'}>
        {form && <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><Input label="Carátula" required value={form.caratula} onChange={(v) => setForm({ ...form, caratula: v })} placeholder="Consorcio ... c/ ... s/ ejecución de expensas" /></div>
            <Input label="N° de expediente" value={form.expediente} onChange={(v) => setForm({ ...form, expediente: v })} />
            <Input label="Juzgado" value={form.juzgado} onChange={(v) => setForm({ ...form, juzgado: v })} />
            <Input label="Objeto" value={form.objeto} onChange={(v) => setForm({ ...form, objeto: v })} />
            <Input label="Monto reclamado" type="number" step="0.01" value={form.monto_reclamado} onChange={(v) => setForm({ ...form, monto_reclamado: v })} />
            <Select label="Unidad involucrada (opcional)" value={form.unidad_id} onChange={(v) => setForm({ ...form, unidad_id: v })} placeholder="— Ninguna —" options={unidades.map((u) => ({ value: u.id, label: ufTxt(u) }))} />
            <Select label="Estado" value={form.estado} onChange={(v) => setForm({ ...form, estado: v })} options={[{ value: 'activo', label: 'Activo (sale en la expensa)' }, { value: 'finalizado', label: 'Finalizado' }]} />
            <div className="sm:col-span-2"><Textarea label="Comentario / estado del trámite" value={form.comentario} onChange={(v) => setForm({ ...form, comentario: v })} rows={2} /></div>
          </div>
          {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></div>
        </>}
      </Modal>
    </div>
  );
}

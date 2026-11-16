import { useEffect, useState } from 'react';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { supabase, type AjusteUnidad, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { fmtDate, fmtMoney, hoyISO, periodoLabel } from '@/lib/engine';
import { ufTxt } from '@/lib/avisos';

export const TIPOS_AJUSTE: Record<AjusteUnidad['tipo'], string> = {
  cargo: 'Cargo a la unidad', descuento: 'Descuento / bonificación', quita_deuda: 'Quita de deuda e intereses', quita_intereses: 'Quita de intereses',
  multa: 'Multa', reserva: 'Reserva de amenity', plan: 'Cuota de plan de pago',
};
const AYUDA: Partial<Record<AjusteUnidad['tipo'], string>> = {
  cargo: 'Suma el importe sólo a esta unidad (no sale de la caja del consorcio).',
  descuento: 'Resta el importe del total de esta unidad.',
  quita_deuda: 'Dejá el monto en 0 para cancelar toda la deuda y los intereses, o poné cuánto querés quitar.',
  quita_intereses: 'Dejá el monto en 0 para cancelar todos los intereses, o poné cuánto querés quitar.',
};

/** Ajustes por unidad: cargos, descuentos y quitas que impactan en la próxima expensa que se cierre. */
export function Ajustes() {
  const { consorcio, usuario } = useApp();
  const [items, setItems] = useState<AjusteUnidad[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [err, setErr] = useState('');
  const vacio = { unidad_id: '', tipo: 'cargo' as AjusteUnidad['tipo'], concepto: '', monto: '', fecha: hoyISO() };
  const [form, setForm] = useState(vacio);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [a, u] = await Promise.all([
      supabase.from('ajustes_unidad').select('*, unidades(*), liquidaciones(periodo, estado)').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false }).limit(300),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true).order('uf'),
    ]);
    setItems((a.data as AjusteUnidad[]) || []); setUnidades((u.data as Unidad[]) || []); setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const guardar = async () => {
    if (!consorcio) return;
    const monto = Math.abs(parseFloat(form.monto.replace(',', '.')) || 0);
    const esQuita = form.tipo === 'quita_deuda' || form.tipo === 'quita_intereses';
    if (!form.unidad_id) return setErr('Elegí la unidad.');
    if (!form.concepto.trim()) return setErr('Escribí el concepto: sale en la expensa.');
    if (!esQuita && monto <= 0) return setErr('Poné el monto.');
    const { error } = await supabase.from('ajustes_unidad').insert({ consorcio_id: consorcio.id, unidad_id: form.unidad_id, tipo: form.tipo, concepto: form.concepto.trim(), monto, fecha: form.fecha, creado_por: usuario });
    if (error) return setErr(error.message);
    setModal(false); setForm(vacio); setErr(''); load();
  };
  const borrar = async (a: AjusteUnidad) => { await supabase.from('ajustes_unidad').delete().eq('id', a.id); load(); };

  if (!consorcio) return null;
  const pendientes = items.filter((a) => !a.liquidacion_id);
  return (
    <div>
      <PageHeader title={`Ajustes por unidad · ${consorcio.nombre}`} subtitle="Cargos, descuentos y quitas de deuda o intereses. Entran en la próxima expensa que se cierre y salen detallados en el resumen."
        action={<Button onClick={() => { setErr(''); setModal(true); }}><Plus size={16} /> Nuevo ajuste</Button>} />
      {pendientes.length > 0 && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">{pendientes.length} ajuste{pendientes.length > 1 ? 's' : ''} pendiente{pendientes.length > 1 ? 's' : ''}: se aplican al cerrar la próxima expensa. Con "Simular" en Liquidaciones ya se ven en el prorrateo.</p>}
      {loading ? <Spinner /> : items.length === 0 ? <Card><EmptyState icon={<SlidersHorizontal size={28} />} title="Sin ajustes" subtitle="Usalos para cobrarle algo a una sola unidad o para quitarle deuda o intereses." /></Card> : (
        <Card><Table headers={['Fecha', 'Unidad', 'Tipo', 'Concepto', 'Monto', 'Expensa', '']}>
          {items.map((a) => {
            const cerrada = a.liquidaciones && a.liquidaciones.estado !== 'abierta';
            return (
              <tr key={a.id} className="hover:bg-slate-50">
                <Td>{fmtDate(a.fecha)}</Td><Td className="font-medium">{ufTxt(a.unidades)}</Td><Td>{TIPOS_AJUSTE[a.tipo]}</Td>
                <Td className="text-slate-500 max-w-xs truncate">{a.concepto}</Td>
                <Td className="text-right">{a.monto_aplicado != null ? fmtMoney(a.monto_aplicado) : Number(a.monto) ? fmtMoney(a.monto) : 'total'}</Td>
                <Td>{a.liquidaciones ? <Badge color="blue">{periodoLabel(a.liquidaciones.periodo)}</Badge> : <Badge color="amber">PENDIENTE</Badge>}</Td>
                <Td>{!cerrada && <button onClick={() => borrar(a)} title="Eliminar" className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>}</Td>
              </tr>
            );
          })}
        </Table></Card>
      )}
      <Modal open={modal} onClose={() => setModal(false)} title="Nuevo ajuste">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Unidad" required value={form.unidad_id} onChange={(v) => setForm({ ...form, unidad_id: v })} placeholder="— Elegir —" options={unidades.map((u) => ({ value: u.id, label: `${ufTxt(u)} · ${u.propietario || ''}` }))} />
          <Select label="Tipo" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v as AjusteUnidad['tipo'] })} options={(['cargo', 'descuento', 'quita_deuda', 'quita_intereses'] as const).map((k) => ({ value: k, label: TIPOS_AJUSTE[k] }))} />
          <div className="sm:col-span-2"><Input label="Concepto (sale en la expensa)" required value={form.concepto} onChange={(v) => setForm({ ...form, concepto: v })} placeholder="Ej.: Reposición llave magnética" /></div>
          <Input label="Monto" type="number" step="0.01" value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} />
          <Input label="Fecha" type="date" value={form.fecha} onChange={(v) => setForm({ ...form, fecha: v })} />
        </div>
        <p className="text-xs text-slate-500 mt-3">{AYUDA[form.tipo]}</p>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></div>
      </Modal>
    </div>
  );
}

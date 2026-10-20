import { useEffect, useState } from 'react';
import { HandCoins, Plus, Trash2 } from 'lucide-react';
import { supabase, type PlanPago, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, fmtMoney, hoyISO, registrarPago, round2, saldosPorUnidad } from '@/lib/engine';

/** Refinanciación de deuda de expensas en cuotas. Cada cuota cobrada registra un pago real (baja la deuda). */
export function PlanesPago() {
  const { consorcio, usuario } = useApp();
  const [items, setItems] = useState<PlanPago[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ unidad_id: '', deuda_original: '', interes_pct: '0', cantidad_cuotas: '3', fecha_inicio: hoyISO(), observaciones: '' });
  const [deleteTarget, setDeleteTarget] = useState<PlanPago | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [{ data: p }, { data: us }] = await Promise.all([
      supabase.from('planes_pago').select('*, unidades(*)').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false }),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).order('uf'),
    ]);
    setItems((p as PlanPago[]) || []);
    setUnidades((us as Unidad[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const montoCuota = () => {
    const deuda = parseFloat(form.deuda_original) || 0;
    const interes = parseFloat(form.interes_pct) || 0;
    const cuotas = parseInt(form.cantidad_cuotas) || 1;
    return round2((deuda * (1 + interes / 100)) / cuotas);
  };

  const cargarDeuda = async (unidadId: string) => {
    if (!consorcio) return;
    const saldos = await saldosPorUnidad(consorcio.id);
    const s = saldos.get(unidadId)?.saldo || 0;
    setForm((f) => ({ ...f, unidad_id: unidadId, deuda_original: s > 0 ? String(s) : f.deuda_original }));
  };

  const save = async () => {
    if (!consorcio) return;
    if (!form.unidad_id || !(parseFloat(form.deuda_original) > 0)) { setError('Elegí la unidad y una deuda mayor a cero.'); return; }
    setError('');
    const { error: err } = await supabase.from('planes_pago').insert({
      consorcio_id: consorcio.id, unidad_id: form.unidad_id,
      deuda_original: parseFloat(form.deuda_original), interes_pct: parseFloat(form.interes_pct) || 0,
      cantidad_cuotas: parseInt(form.cantidad_cuotas) || 1, monto_cuota: montoCuota(),
      fecha_inicio: form.fecha_inicio, observaciones: form.observaciones || null,
    });
    if (err) { setError(err.message); return; }
    setModal(false); load();
  };

  const cobrarCuota = async (p: PlanPago) => {
    if (!consorcio || busy) return;
    setBusy(true);
    try {
      await registrarPago({
        consorcio_id: consorcio.id, unidad_id: p.unidad_id, cupon_id: null,
        fecha: hoyISO(), monto: Number(p.monto_cuota), metodo: 'transferencia',
        observaciones: `Plan de pago: cuota ${p.cuotas_pagadas + 1}/${p.cantidad_cuotas}`, registrado_por: usuario,
      });
      const pagadas = p.cuotas_pagadas + 1;
      await supabase.from('planes_pago').update({
        cuotas_pagadas: pagadas, estado: pagadas >= p.cantidad_cuotas ? 'cumplido' : 'vigente',
      }).eq('id', p.id);
      await load();
    } finally { setBusy(false); }
  };

  const marcarCaido = async (p: PlanPago) => {
    await supabase.from('planes_pago').update({ estado: 'caido' }).eq('id', p.id);
    load();
  };

  if (!consorcio) return null;

  return (
    <div>
      <PageHeader title={`Planes de pago · ${consorcio.nombre}`} subtitle="Refinanciación de deuda en cuotas; cada cuota cobrada impacta como pago en la cuenta corriente"
        action={<Button onClick={() => { setError(''); setModal(true); }}><Plus size={16} /> Nuevo plan</Button>} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<HandCoins size={28} />} title="Sin planes de pago" subtitle="Creá un plan para una UF con deuda y cobrá las cuotas desde acá." /></Card>
      ) : (
        <Card>
          <Table headers={['UF', 'Propietario', 'Deuda original', 'Interés', 'Cuotas', 'Valor cuota', 'Pagadas', 'Inicio', 'Estado', '']}>
            {items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{String(p.unidades?.uf ?? '').padStart(3, '0')}</Td>
                <Td className="font-medium">{p.unidades?.propietario || p.unidades?.depto}</Td>
                <Td>{fmtMoney(Number(p.deuda_original))}</Td>
                <Td>{p.interes_pct}%</Td>
                <Td>{p.cantidad_cuotas}</Td>
                <Td className="font-semibold">{fmtMoney(Number(p.monto_cuota))}</Td>
                <Td>{p.cuotas_pagadas}/{p.cantidad_cuotas}</Td>
                <Td>{fmtDate(p.fecha_inicio)}</Td>
                <Td><Badge color={p.estado === 'vigente' ? 'blue' : p.estado === 'cumplido' ? 'green' : 'red'}>{p.estado}</Badge></Td>
                <Td>
                  <div className="flex gap-1">
                    {p.estado === 'vigente' && <Button size="sm" onClick={() => cobrarCuota(p)} disabled={busy}>Cobrar cuota</Button>}
                    {p.estado === 'vigente' && <Button size="sm" variant="ghost" onClick={() => marcarCaido(p)}>Caído</Button>}
                    <button onClick={() => setDeleteTarget(p)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Nuevo plan de pago">
        <Select label="Unidad" value={form.unidad_id} onChange={cargarDeuda} placeholder="— Elegir UF —"
          options={unidades.map((u) => ({ value: u.id, label: `UF ${u.uf} · ${u.depto} · ${u.propietario || 'sin prop.'}` }))} required />
        <p className="text-xs text-slate-400 mt-1 mb-3">Al elegir la UF se carga automáticamente su deuda actual (si tiene).</p>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Deuda a refinanciar" type="number" step="0.01" value={form.deuda_original} onChange={(v) => setForm({ ...form, deuda_original: v })} required />
          <Input label="Interés de financiación (%)" type="number" step="0.01" value={form.interes_pct} onChange={(v) => setForm({ ...form, interes_pct: v })} />
          <Input label="Cantidad de cuotas" type="number" value={form.cantidad_cuotas} onChange={(v) => setForm({ ...form, cantidad_cuotas: v })} />
          <Input label="Fecha de inicio" type="date" value={form.fecha_inicio} onChange={(v) => setForm({ ...form, fecha_inicio: v })} />
        </div>
        <div className="mt-3"><Input label="Observaciones" value={form.observaciones} onChange={(v) => setForm({ ...form, observaciones: v })} /></div>
        <p className="text-right text-sm mt-3">Valor de cada cuota: <b className="text-lg">{fmtMoney(montoCuota())}</b></p>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={save}>Crear plan</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar plan"
        message="¿Eliminar el plan de pago? Los pagos de cuotas ya registrados quedan en la cuenta corriente."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('planes_pago').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

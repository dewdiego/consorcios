import { useEffect, useState } from 'react';
import { Banknote, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { supabase, type Cuenta, type Gasto, type OrdenPago, type Proveedor } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, fmtMoney, hoyISO, pagarOrdenPago, round2 } from '@/lib/engine';

/** Pago a proveedores: arma órdenes de pago a partir de gastos impagos y las liquida contra una cuenta. */
export function OrdenesPago() {
  const { consorcio } = useApp();
  const [ops, setOps] = useState<OrdenPago[]>([]);
  const [gastosOP, setGastosOP] = useState<Record<string, Gasto[]>>({});
  const [impagos, setImpagos] = useState<Gasto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [provSel, setProvSel] = useState('');
  const [gastosSel, setGastosSel] = useState<string[]>([]);
  const [metodo, setMetodo] = useState('transferencia');
  const [obs, setObs] = useState('');
  const [pagarTarget, setPagarTarget] = useState<OrdenPago | null>(null);
  const [cuentaSel, setCuentaSel] = useState('');
  const [anularTarget, setAnularTarget] = useState<OrdenPago | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [o, g, pr, cu] = await Promise.all([
      supabase.from('ordenes_pago').select('*, proveedores(*)').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false }),
      supabase.from('gastos').select('*, proveedores(*)').eq('consorcio_id', consorcio.id).eq('pagado', false).is('orden_pago_id', null).order('fecha'),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('cuentas').select('*').eq('consorcio_id', consorcio.id).eq('activa', true),
    ]);
    const opList = (o.data as OrdenPago[]) || [];
    setOps(opList);
    setImpagos((g.data as Gasto[]) || []);
    setProveedores((pr.data as Proveedor[]) || []);
    setCuentas((cu.data as Cuenta[]) || []);
    if (opList.length) {
      const { data: gv } = await supabase.from('gastos').select('*').in('orden_pago_id', opList.map((x) => x.id));
      const map: Record<string, Gasto[]> = {};
      for (const gg of (gv as Gasto[]) || []) {
        if (!gg.orden_pago_id) continue;
        (map[gg.orden_pago_id] ||= []).push(gg);
      }
      setGastosOP(map);
    } else setGastosOP({});
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const candidatos = impagos.filter((g) => !provSel || g.proveedor_id === provSel);
  const totalSel = round2(candidatos.filter((g) => gastosSel.includes(g.id)).reduce((a, g) => a + Number(g.monto), 0));

  const crear = async () => {
    if (!consorcio) return;
    if (gastosSel.length === 0) { setError('Seleccioná al menos un gasto a pagar.'); return; }
    setError('');
    const { data: op, error: err } = await supabase.from('ordenes_pago').insert({
      consorcio_id: consorcio.id, proveedor_id: provSel || null, fecha: hoyISO(),
      monto: totalSel, metodo, observaciones: obs || null,
    }).select().single();
    if (err) { setError(err.message); return; }
    await supabase.from('gastos').update({ orden_pago_id: op.id }).in('id', gastosSel);
    setModal(false); setGastosSel([]); setProvSel(''); setObs('');
    load();
  };

  const pagar = async () => {
    if (!pagarTarget) return;
    try {
      await pagarOrdenPago(pagarTarget.id, cuentaSel || null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setPagarTarget(null); load();
  };

  const anular = async () => {
    if (!anularTarget) return;
    await supabase.from('gastos').update({ orden_pago_id: null }).eq('orden_pago_id', anularTarget.id);
    await supabase.from('ordenes_pago').update({ estado: 'anulada' }).eq('id', anularTarget.id);
    setAnularTarget(null); load();
  };

  if (!consorcio) return null;

  return (
    <div>
      <PageHeader title={`Pago a proveedores · ${consorcio.nombre}`}
        subtitle={`${impagos.length} gastos impagos sin orden · ${fmtMoney(impagos.reduce((a, g) => a + Number(g.monto), 0))}`}
        action={<Button onClick={() => { setError(''); setModal(true); }}><Plus size={16} /> Nueva orden de pago</Button>} />
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {loading ? <Spinner /> : ops.length === 0 ? (
        <Card><EmptyState icon={<Banknote size={28} />} title="Sin órdenes de pago" subtitle="Agrupá gastos impagos en una orden y marcala como pagada cuando salga el dinero." /></Card>
      ) : (
        <Card>
          <Table headers={['N°', 'Fecha', 'Proveedor', 'Gastos incluidos', 'Método', 'Monto', 'Estado', '']}>
            {ops.map((op) => (
              <tr key={op.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">OP-{String(op.numero).padStart(4, '0')}</Td>
                <Td>{fmtDate(op.fecha)}</Td>
                <Td className="font-medium">{op.proveedores?.nombre || 'Varios'}</Td>
                <Td className="text-xs text-slate-500 max-w-sm">{(gastosOP[op.id] || []).map((g) => g.descripcion).join(' · ') || '—'}</Td>
                <Td className="capitalize">{op.metodo}</Td>
                <Td className="font-semibold">{fmtMoney(Number(op.monto))}</Td>
                <Td><Badge color={op.estado === 'pagada' ? 'green' : op.estado === 'anulada' ? 'slate' : 'amber'}>{op.estado}</Badge></Td>
                <Td>
                  <div className="flex gap-1">
                    {op.estado === 'pendiente' && <Button size="sm" onClick={() => { setCuentaSel(cuentas[0]?.id || ''); setPagarTarget(op); }}><CheckCircle2 size={13} /> Pagar</Button>}
                    {op.estado === 'pendiente' && <button onClick={() => setAnularTarget(op)} className="p-1.5 rounded text-red-400 hover:bg-red-50" title="Anular"><Trash2 size={14} /></button>}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* Nueva OP */}
      <Modal open={modal} onClose={() => setModal(false)} title="Nueva orden de pago" size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Select label="Proveedor (filtra los gastos)" value={provSel} onChange={(v) => { setProvSel(v); setGastosSel([]); }} placeholder="— Todos —"
            options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} />
          <Select label="Método de pago" value={metodo} onChange={setMetodo}
            options={[{ value: 'transferencia', label: 'Transferencia' }, { value: 'efectivo', label: 'Efectivo' }, { value: 'cheque', label: 'Cheque' }]} />
        </div>
        <p className="text-sm font-medium text-slate-600 mb-2">Gastos impagos a incluir</p>
        <div className="border border-slate-200 rounded-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
          {candidatos.length === 0 && <p className="text-sm text-slate-400 p-4">No hay gastos impagos{provSel ? ' de ese proveedor' : ''}.</p>}
          {candidatos.map((g) => (
            <label key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" className="rounded" checked={gastosSel.includes(g.id)}
                onChange={(e) => setGastosSel((prev) => e.target.checked ? [...prev, g.id] : prev.filter((x) => x !== g.id))} />
              <span className="flex-1 truncate">{g.descripcion} <span className="text-slate-400 text-xs">({g.proveedores?.nombre || 'sin prov.'} · {fmtDate(g.fecha)})</span></span>
              <b>{fmtMoney(Number(g.monto))}</b>
            </label>
          ))}
        </div>
        <div className="mt-3"><Input label="Observaciones" value={obs} onChange={setObs} /></div>
        <p className="text-right text-sm mt-3">Total de la orden: <b className="text-lg">{fmtMoney(totalSel)}</b></p>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={crear} disabled={gastosSel.length === 0}>Crear orden</Button>
        </div>
      </Modal>

      {/* Pagar OP */}
      <Modal open={!!pagarTarget} onClose={() => setPagarTarget(null)} title={`Pagar OP-${String(pagarTarget?.numero || '').padStart(4, '0')}`} size="sm">
        <p className="text-sm text-slate-600 mb-4">Se marcan los gastos como pagados y se genera el egreso de {fmtMoney(Number(pagarTarget?.monto || 0))} en la caja elegida.</p>
        <Select label="Cuenta / caja de salida" value={cuentaSel} onChange={setCuentaSel} placeholder="— Sin cuenta (solo registro) —"
          options={cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.tipo})` }))} />
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setPagarTarget(null)}>Cancelar</Button>
          <Button onClick={pagar}>Confirmar pago</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!anularTarget} title="Anular orden de pago"
        message={`¿Anular la OP-${String(anularTarget?.numero || '').padStart(4, '0')}? Los gastos vuelven a quedar impagos y disponibles.`}
        onCancel={() => setAnularTarget(null)} onConfirm={anular} />
    </div>
  );
}

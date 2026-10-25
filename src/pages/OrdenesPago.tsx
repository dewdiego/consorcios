import { useEffect, useState } from 'react';
import { Banknote, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { supabase, type Cuenta, type Gasto, type OrdenPago, type Proveedor } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Ayuda } from '@/components/Ayuda';
import { calcularRetenciones, cargarParametros, fmtDate, fmtMoney, hoyISO, pagarOrdenPago, round2, type Params, type RetencionPropuesta } from '@/lib/engine';

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
  const [params, setParams] = useState<Params>({});
  const [rets, setRets] = useState<RetencionPropuesta[]>([]);
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [pagando, setPagando] = useState(false);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    cargarParametros().then(setParams);
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

  const abrirPagar = (op: OrdenPago) => {
    setCuentaSel(cuentas.find((c) => c.predeterminada)?.id || cuentas[0]?.id || '');
    setFechaPago(hoyISO());
    setRets(calcularRetenciones(op.proveedores, Number(op.monto), params));
    setError('');
    setPagarTarget(op);
  };
  const pagar = async () => {
    if (!pagarTarget) return;
    setPagando(true);
    try {
      await pagarOrdenPago(pagarTarget.id, cuentaSel || null, rets.filter((r) => r.monto > 0), fechaPago);
      setPagarTarget(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setPagando(false); load();
  };
  const totalRets = round2(rets.reduce((a, r) => a + r.monto, 0));

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
      <Ayuda id="op" titulo="Cómo pagar a proveedores y qué pasa con las retenciones">
        <ol>
          <li><b>Nueva orden de pago</b>: elegí el proveedor y tildá las facturas que vas a pagar. Una orden = un pago.</li>
          <li><b>Pagar</b>: si el proveedor tiene régimen de retención marcado (en Proveedores), el sistema calcula Ganancias / IIBB / SUSS y paga el <b>neto</b>. Transferí al proveedor exactamente ese neto.</li>
          <li>Las retenciones quedan en <b>Contabilidad → Retenciones</b> como pendientes de depósito. Entregale al proveedor el certificado de retención (lo genera SIRE para Ganancias/SUSS y AGIP para IIBB).</li>
          <li><b>Antes del día 10 del mes siguiente</b>: presentar en ARCA → SIRE las retenciones de Ganancias y SUSS del mes y pagarlas; IIBB en AGIP (CABA) o ARBA (provincia). Usá "Exportar para el contador" de esa pestaña.</li>
        </ol>
      </Ayuda>

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
                <Td className="font-semibold">{fmtMoney(Number(op.monto))}{Number(op.retenciones_total) > 0 && <div className="text-xs text-slate-400">ret. {fmtMoney(Number(op.retenciones_total))} · neto {fmtMoney(Number(op.neto_pagado))}</div>}</Td>
                <Td><Badge color={op.estado === 'pagada' ? 'green' : op.estado === 'anulada' ? 'slate' : 'amber'}>{op.estado}</Badge>{op.fecha_pago && <div className="text-xs text-slate-400">{fmtDate(op.fecha_pago)}</div>}</Td>
                <Td>
                  <div className="flex gap-1">
                    {op.estado === 'pendiente' && <Button size="sm" onClick={() => abrirPagar(op)}><CheckCircle2 size={13} /> Pagar</Button>}
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
      <Modal open={!!pagarTarget} onClose={() => setPagarTarget(null)} title={`Pagar OP-${String(pagarTarget?.numero || '').padStart(4, '0')} · ${pagarTarget?.proveedores?.nombre || 'Varios'}`}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Cuenta / caja de salida" value={cuentaSel} onChange={setCuentaSel} placeholder="— Predeterminada —"
            options={cuentas.map((c) => ({ value: c.id, label: `${c.nombre} (${c.tipo})` }))} />
          <Input label="Fecha de pago" type="date" value={fechaPago} onChange={setFechaPago} />
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 divide-y divide-slate-100 text-sm">
          <div className="flex justify-between px-3 py-2"><span>Importe de la orden</span><b>{fmtMoney(Number(pagarTarget?.monto || 0))}</b></div>
          {rets.map((r, i) => (
            <div key={r.tipo} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>Retención {r.tipo.toUpperCase()} <span className="text-xs text-slate-400">base {fmtMoney(r.base)} × {r.alicuota}%</span></span>
              <input type="number" step="0.01" value={r.monto} onChange={(e) => setRets(rets.map((x, j) => j === i ? { ...x, monto: parseFloat(e.target.value) || 0 } : x))} className="w-32 text-right border border-slate-200 rounded px-2 py-1 text-sm" />
            </div>
          ))}
          {rets.length === 0 && pagarTarget?.proveedores && <div className="px-3 py-2 text-xs text-slate-400">Sin retenciones (el proveedor no tiene régimen marcado o no supera el mínimo).</div>}
          <div className="flex justify-between px-3 py-2 bg-slate-50 font-semibold"><span>Neto a pagar{totalRets ? ' (importe − retenciones)' : ''}</span><b className="text-lg">{fmtMoney(round2(Number(pagarTarget?.monto || 0) - totalRets))}</b></div>
        </div>
        <p className="text-xs text-slate-400 mt-3">Se marcan los gastos como pagados, sale de caja el neto y las retenciones quedan pendientes de depósito en Contabilidad → Retenciones.</p>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setPagarTarget(null)}>Cancelar</Button>
          <Button onClick={pagar} disabled={pagando}>Confirmar pago</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!anularTarget} title="Anular orden de pago"
        message={`¿Anular la OP-${String(anularTarget?.numero || '').padStart(4, '0')}? Los gastos vuelven a quedar impagos y disponibles.`}
        onCancel={() => setAnularTarget(null)} onConfirm={anular} />
    </div>
  );
}

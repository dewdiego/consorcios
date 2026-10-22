import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileText, Lock, Plus, Receipt, RefreshCw, Send, Trash2, Unlock } from 'lucide-react';
import { supabase, type Cupon, type Gasto, type Liquidacion, type Pago, type Proveedor, type Rubro } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { GastoModal } from '@/components/GastoModal';
import {
  CATEGORIAS, cerrarLiquidacion, eliminarPago, fmtDate, fmtMoney, generarCupones, hoyISO,
  montoEsperado, notificar, periodoActual, periodoLabel, periodoSiguiente, reabrirLiquidacion, registrarPago, round2,
} from '@/lib/engine';

const estadoLiq: Record<string, { color: 'amber' | 'blue' | 'green'; label: string }> = {
  abierta: { color: 'amber', label: 'ABIERTA' },
  cerrada: { color: 'blue', label: 'CERRADA' },
  enviada: { color: 'green', label: 'ENVIADA' },
};

export function Liquidaciones() {
  const { consorcio, usuario } = useApp();
  const [liqs, setLiqs] = useState<Liquidacion[]>([]);
  const [cobradoPorLiq, setCobradoPorLiq] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const { data } = await supabase.from('liquidaciones').select('*').eq('consorcio_id', consorcio.id).order('periodo', { ascending: false });
    const ls = (data as Liquidacion[]) || [];
    setLiqs(ls);
    // cobrado por liquidación: pagos imputados a cupones de cada liq
    const { data: pagos } = await supabase.from('pagos')
      .select('monto, cupones!inner(liquidacion_id)').eq('consorcio_id', consorcio.id).not('cupon_id', 'is', null);
    const map: Record<string, number> = {};
    for (const p of (pagos || []) as unknown as { monto: number; cupones: { liquidacion_id: string } }[]) {
      map[p.cupones.liquidacion_id] = (map[p.cupones.liquidacion_id] || 0) + Number(p.monto);
    }
    setCobradoPorLiq(map);
    setLoading(false);
  };
  useEffect(() => { setDetalleId(null); load(); }, [consorcio?.id]);

  const nueva = async () => {
    if (!consorcio) return;
    const ultimo = liqs[0]?.periodo;
    const periodo = ultimo ? periodoSiguiente(ultimo) : periodoActual();
    const [y, m] = periodo.split('-').map(Number);
    const fv = (dia: number) => {
      const next = new Date(y, m, Math.min(dia, 28)); // vence el mes siguiente al período liquidado
      return next.toISOString().slice(0, 10);
    };
    const { data, error } = await supabase.from('liquidaciones').insert({
      consorcio_id: consorcio.id, periodo,
      fecha_vencimiento_1: fv(consorcio.dia_vencimiento_1),
      fecha_vencimiento_2: fv(consorcio.dia_vencimiento_2),
      recargo_2do_venc_pct: consorcio.recargo_2do_venc_pct,
      interes_mora_pct: consorcio.interes_mora_mensual_pct,
    }).select().single();
    if (error) { setMsg(error.message); return; }
    await load();
    setDetalleId(data.id);
  };

  if (!consorcio) return null;
  if (detalleId) {
    const liq = liqs.find((l) => l.id === detalleId);
    if (liq) return <LiquidacionDetalle liq={liq} usuario={usuario} onBack={() => { setDetalleId(null); load(); }} />;
  }

  const actual = liqs[0];
  const anterior = liqs[1];

  return (
    <div>
      <PageHeader title={`Expensas · ${consorcio.nombre}`} subtitle="Liquidaciones mensuales"
        action={<Button onClick={nueva}><Plus size={16} /> Nueva liquidación</Button>} />
      {msg && <p className="text-sm text-red-500 mb-3">{msg}</p>}

      {loading ? <Spinner /> : liqs.length === 0 ? (
        <Card><EmptyState icon={<Receipt size={28} />} title="Todavía no hay liquidaciones" subtitle="Creá la primera liquidación del período para empezar a cargar gastos." /></Card>
      ) : (
        <>
          {/* Cards de los dos últimos períodos, como en Octavo */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {[anterior, actual].filter(Boolean).map((l) => {
              const cobrado = cobradoPorLiq[l!.id] || 0;
              const pct = l!.total_distribuido > 0 ? (cobrado / Number(l!.total_distribuido)) * 100 : 0;
              return (
                <Card key={l!.id} className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-teal-600 font-semibold">{periodoLabel(l!.periodo)}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Recaudado</p>
                      <p className="text-2xl font-bold text-slate-800">{fmtMoney(cobrado)}</p>
                      <div className="mt-1"><Badge color={estadoLiq[l!.estado].color}>{estadoLiq[l!.estado].label}</Badge></div>
                      {l!.cerrada_por && <p className="text-[11px] text-slate-400 mt-2">Cerrada por {l!.cerrada_por} el {fmtDate(l!.cerrada_at?.slice(0, 10))}</p>}
                      {l!.enviada_at && <p className="text-[11px] text-slate-400">Enviada a todos el {fmtDate(l!.enviada_at.slice(0, 10))}</p>}
                    </div>
                    <div className="relative w-20 h-20 rounded-full shrink-0" style={{ background: `conic-gradient(#14b8a6 ${Math.min(100, pct) * 3.6}deg, #e2e8f0 0deg)` }}>
                      <div className="absolute inset-1.5 bg-white rounded-full flex flex-col items-center justify-center">
                        <span className="text-sm font-bold text-slate-700">{Math.round(pct)}%</span>
                        <span className="text-[9px] text-slate-400">Cobranza</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
                    <Button size="sm" variant="secondary" onClick={() => setDetalleId(l!.id)}><FileText size={13} /> Resumen</Button>
                    <Button size="sm" variant="secondary" onClick={() => setDetalleId(l!.id)}><Receipt size={13} /> Cupones</Button>
                  </div>
                </Card>
              );
            })}
          </div>

          <Card>
            <Table headers={['Período', 'Vencimiento', 'Estado', 'Gastos', 'Distribuido', 'Cobrado', 'Cumplimiento', '']}>
              {liqs.map((l) => {
                const cobrado = cobradoPorLiq[l.id] || 0;
                const pct = l.total_distribuido > 0 ? Math.min(100, (cobrado / Number(l.total_distribuido)) * 100) : 0;
                return (
                  <tr key={l.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetalleId(l.id)}>
                    <Td className="font-medium">{l.periodo}</Td>
                    <Td>{fmtDate(l.fecha_vencimiento_1)}</Td>
                    <Td><Badge color={estadoLiq[l.estado].color}>{estadoLiq[l.estado].label}</Badge></Td>
                    <Td>{fmtMoney(Number(l.total_gastos))}</Td>
                    <Td>{fmtMoney(Number(l.total_distribuido))}</Td>
                    <Td>{fmtMoney(cobrado)}</Td>
                    <Td>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500" style={{ width: `${pct}%` }} /></div>
                        <span className="text-xs text-slate-500 w-10">{Math.round(pct)}%</span>
                      </div>
                    </Td>
                    <Td><span className="text-teal-600 text-xs font-medium">Abrir →</span></Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

// ==================== Detalle de liquidación ====================

function LiquidacionDetalle({ liq: liqInicial, usuario, onBack }: { liq: Liquidacion; usuario: string; onBack: () => void }) {
  const { consorcio } = useApp();
  const [liq, setLiq] = useState(liqInicial);
  const [tab, setTab] = useState('gastos');
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [cupones, setCupones] = useState<Cupon[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [pendientes, setPendientes] = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'warn'; texto: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);

  // modales
  const [gastoModal, setGastoModal] = useState(false);
  const [gastoForm, setGastoForm] = useState({ descripcion: '', proveedor_id: '', rubro_id: '', categoria: 'A', monto: '', fecha: hoyISO(), comprobante: '' });
  const [pagoModal, setPagoModal] = useState<Cupon | null>(null);
  const [pagoForm, setPagoForm] = useState({ fecha: hoyISO(), monto: '', metodo: 'transferencia', comprobante: '', observaciones: '' });

  const abierta = liq.estado === 'abierta';

  const loadAll = async () => {
    setLoading(true);
    const [g, c, pr, r, pend, l] = await Promise.all([
      supabase.from('gastos').select('*, proveedores(*), rubros(*)').eq('liquidacion_id', liq.id).order('fecha'),
      supabase.from('cupones').select('*, unidades(*)').eq('liquidacion_id', liq.id),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('rubros').select('*').order('orden'),
      supabase.from('gastos').select('*, proveedores(*)').eq('consorcio_id', liq.consorcio_id).is('liquidacion_id', null),
      supabase.from('liquidaciones').select('*').eq('id', liq.id).single(),
    ]);
    setGastos((g.data as Gasto[]) || []);
    const cs = ((c.data as Cupon[]) || []).sort((a, b) => (a.unidades?.uf || 0) - (b.unidades?.uf || 0));
    setCupones(cs);
    setProveedores((pr.data as Proveedor[]) || []);
    setRubros((r.data as Rubro[]) || []);
    setPendientes((pend.data as Gasto[]) || []);
    if (l.data) setLiq(l.data as Liquidacion);
    if (cs.length > 0) {
      const { data: pg } = await supabase.from('pagos').select('*, unidades(*)').in('cupon_id', cs.map((x) => x.id)).order('fecha', { ascending: false });
      setPagos((pg as Pago[]) || []);
    } else setPagos([]);
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, [liq.id]);

  const totalesPorCat = useMemo(() => {
    const t: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const g of gastos) { t.A += Number(g.monto_a); t.B += Number(g.monto_b); t.C += Number(g.monto_c); t.D += Number(g.monto_d); }
    return t;
  }, [gastos]);
  const totalGastos = round2(totalesPorCat.A + totalesPorCat.B + totalesPorCat.C + totalesPorCat.D);
  const totalCobrado = round2(pagos.reduce((a, p) => a + Number(p.monto), 0));

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try {
      const texto = await fn();
      if (texto) setMsg({ tipo: 'ok', texto });
      await loadAll();
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  // ---- acciones de gastos ----
  const agregarGasto = () => run(async () => {
    if (!gastoForm.descripcion.trim() || !gastoForm.monto) throw new Error('Completá descripción y monto.');
    const { error } = await supabase.from('gastos').insert({
      consorcio_id: liq.consorcio_id, liquidacion_id: liq.id,
      proveedor_id: gastoForm.proveedor_id || null, rubro_id: gastoForm.rubro_id || null,
      descripcion: gastoForm.descripcion.trim(), categoria: gastoForm.categoria,
      monto: parseFloat(gastoForm.monto), fecha: gastoForm.fecha, comprobante: gastoForm.comprobante || null,
    });
    if (error) throw new Error(error.message);
    setGastoModal(false);
    setGastoForm({ descripcion: '', proveedor_id: '', rubro_id: '', categoria: 'A', monto: '', fecha: hoyISO(), comprobante: '' });
  });

  const quitarGasto = (g: Gasto) => run(async () => {
    const { error } = await supabase.from('gastos').update({ liquidacion_id: null }).eq('id', g.id);
    if (error) throw new Error(error.message);
    return 'Gasto desvinculado (quedó en Gastos pendientes).';
  });

  const traerPendientes = () => run(async () => {
    if (pendientes.length === 0) throw new Error('No hay gastos pendientes de este consorcio.');
    const { error } = await supabase.from('gastos').update({ liquidacion_id: liq.id }).eq('consorcio_id', liq.consorcio_id).is('liquidacion_id', null);
    if (error) throw new Error(error.message);
    return `Se vincularon ${pendientes.length} gastos pendientes al período.`;
  });

  const generarProvisiones = () => run(async () => {
    const { data: provs } = await supabase.from('provisiones').select('*').eq('consorcio_id', liq.consorcio_id).eq('activa', true);
    let n = 0;
    const filas = [];
    for (const p of provs || []) {
      if (gastos.some((g) => g.descripcion === `${p.descripcion} (provisión ${liq.periodo})`)) continue;
      filas.push({
        consorcio_id: liq.consorcio_id, liquidacion_id: liq.id, proveedor_id: p.proveedor_id,
        rubro_id: p.rubro_id, descripcion: `${p.descripcion} (provisión ${liq.periodo})`,
        categoria: p.categoria, monto: p.monto_mensual, fecha: hoyISO(),
      });
      n++;
    }
    if (consorcio && Number(consorcio.honorarios_mensuales) > 0 && !gastos.some((g) => g.descripcion === `Honorarios administración ${liq.periodo}`)) {
      const rubroAdm = rubros.find((r) => r.nombre.toLowerCase().includes('honorarios'));
      filas.push({
        consorcio_id: liq.consorcio_id, liquidacion_id: liq.id, proveedor_id: null,
        rubro_id: rubroAdm?.id || null, descripcion: `Honorarios administración ${liq.periodo}`,
        categoria: 'A', monto: consorcio.honorarios_mensuales, fecha: hoyISO(),
      });
      n++;
    }
    if (filas.length === 0) throw new Error('No hay provisiones activas (ni honorarios) para generar, o ya fueron generadas.');
    const { error } = await supabase.from('gastos').insert(filas);
    if (error) throw new Error(error.message);
    return `Se generaron ${n} gastos (provisiones + honorarios).`;
  });

  // ---- acciones de liquidación ----
  const previsualizar = () => run(async () => {
    const res = await generarCupones(liq.id);
    if (res.advertencias.length) setMsg({ tipo: 'warn', texto: res.advertencias.join(' ') });
    setTab('cupones');
    return res.advertencias.length ? undefined : `Cupones generados: ${res.cupones} UF · Distribuido ${fmtMoney(res.totalDistribuido)}.`;
  });

  const cerrar = () => setConfirm({
    title: 'Cerrar liquidación',
    message: `Se van a generar los cupones definitivos de ${periodoLabel(liq.periodo)} (gastos ${fmtMoney(totalGastos)} + saldos anteriores e intereses) y el período queda congelado. ¿Continuar?`,
    action: async () => {
      const res = await cerrarLiquidacion(liq.id, usuario);
      await notificar('info', `Liquidación ${liq.periodo} cerrada`, `${consorcio?.nombre}: ${res.cupones} cupones por ${fmtMoney(res.totalDistribuido)}.`);
      if (res.advertencias.length) setMsg({ tipo: 'warn', texto: res.advertencias.join(' ') });
      setTab('cupones');
    },
  });

  const enviar = () => setConfirm({
    title: 'Enviar expensas',
    message: 'Marca la liquidación como ENVIADA a todos los propietarios (los cupones quedan publicados). ¿Continuar?',
    action: async () => {
      const { error } = await supabase.from('liquidaciones').update({ estado: 'enviada', enviada_at: new Date().toISOString() }).eq('id', liq.id);
      if (error) throw new Error(error.message);
      await notificar('info', `Expensas ${liq.periodo} enviadas`, consorcio?.nombre);
    },
  });

  const reabrir = () => setConfirm({
    title: 'Reabrir liquidación',
    message: 'La liquidación vuelve a ABIERTA para corregir gastos. Al volver a cerrarla, los cupones se regeneran (los pagos ya registrados se conservan y se re-imputan por saldo). ¿Continuar?',
    action: async () => { await reabrirLiquidacion(liq.id); },
  });

  // ---- cobranza ----
  const abrirPago = (c: Cupon) => {
    const esperado = montoEsperado(c, liq.fecha_vencimiento_1, liq.fecha_vencimiento_2);
    const pagado = pagos.filter((p) => p.cupon_id === c.id).reduce((a, p) => a + Number(p.monto), 0);
    setPagoForm({ fecha: hoyISO(), monto: String(round2(Math.max(0, esperado.monto - pagado))), metodo: 'transferencia', comprobante: '', observaciones: '' });
    setPagoModal(c);
  };

  const guardarPago = () => run(async () => {
    if (!pagoModal) return;
    const monto = parseFloat(pagoForm.monto);
    if (!monto || monto <= 0) throw new Error('Ingresá un monto válido.');
    await registrarPago({
      consorcio_id: liq.consorcio_id, unidad_id: pagoModal.unidad_id, cupon_id: pagoModal.id,
      fecha: pagoForm.fecha, monto, metodo: pagoForm.metodo,
      comprobante: pagoForm.comprobante, observaciones: pagoForm.observaciones, registrado_por: usuario,
    });
    setPagoModal(null);
    return 'Pago registrado.';
  });

  const borrarPago = (p: Pago) => setConfirm({
    title: 'Eliminar pago',
    message: `¿Eliminar el pago de ${fmtMoney(Number(p.monto))} del ${fmtDate(p.fecha)}? También se borra su movimiento de caja.`,
    action: async () => { await eliminarPago(p.id); },
  });

  const catLabel = (k: string) => CATEGORIAS.find((c) => c.key === k)?.label || k;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-teal-600 font-medium mb-3 hover:underline"><ArrowLeft size={15} /> Volver a liquidaciones</button>
      <PageHeader title={`${periodoLabel(liq.periodo)} · ${consorcio?.nombre}`}
        subtitle={`1º venc. ${fmtDate(liq.fecha_vencimiento_1)} · 2º venc. ${fmtDate(liq.fecha_vencimiento_2)} (+${liq.recargo_2do_venc_pct}%)${Number(liq.interes_mora_pct) > 0 ? ` · Mora ${liq.interes_mora_pct}%/mes` : ''}`}
        action={
          <div className="flex gap-2 flex-wrap items-center">
            <Badge color={estadoLiq[liq.estado].color}>{estadoLiq[liq.estado].label}</Badge>
            {abierta && <Button variant="secondary" onClick={previsualizar} disabled={busy}><RefreshCw size={15} /> Generar cupones</Button>}
            {abierta && <Button onClick={cerrar} disabled={busy}><Lock size={15} /> Cerrar período</Button>}
            {liq.estado === 'cerrada' && <Button onClick={enviar} disabled={busy}><Send size={15} /> Enviar</Button>}
            {!abierta && <Button variant="secondary" onClick={reabrir} disabled={busy}><Unlock size={15} /> Reabrir</Button>}
          </div>
        } />

      {msg && (
        <div className={`text-sm rounded-lg px-4 py-2.5 mb-4 ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : msg.tipo === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
          {msg.texto}
        </div>
      )}

      {/* Resumen numérico */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="p-4"><p className="text-xs text-slate-400">Gastos del período</p><p className="text-lg font-bold text-slate-800">{fmtMoney(totalGastos)}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Distribuido (c/saldos e int.)</p><p className="text-lg font-bold text-slate-800">{fmtMoney(Number(liq.total_distribuido))}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Cobrado</p><p className="text-lg font-bold text-emerald-600">{fmtMoney(totalCobrado)}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Cobranza</p><p className="text-lg font-bold text-slate-800">{Number(liq.total_distribuido) > 0 ? Math.round((totalCobrado / Number(liq.total_distribuido)) * 100) : 0}%</p></Card>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'gastos', label: 'Gastos', badge: gastos.length },
        { key: 'cupones', label: 'Cupones', badge: cupones.length },
        { key: 'cobranza', label: 'Cobranza', badge: pagos.length },
      ]} />

      {loading ? <Spinner /> : tab === 'gastos' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
            {abierta && <Button size="sm" onClick={() => setGastoModal(true)}><Plus size={14} /> Agregar gasto</Button>}
            {abierta && <Button size="sm" variant="secondary" onClick={traerPendientes} disabled={busy}>Traer gastos pendientes ({pendientes.length})</Button>}
            {abierta && <Button size="sm" variant="secondary" onClick={generarProvisiones} disabled={busy}>Generar provisiones y honorarios</Button>}
            {!abierta && <p className="text-xs text-slate-400 py-1">Período cerrado: para modificar gastos hay que reabrir.</p>}
            <div className="flex-1" />
            <div className="flex gap-3 text-xs text-slate-500 pr-2">
              {CATEGORIAS.map((c) => <span key={c.key}><b>{c.key}:</b> {fmtMoney(totalesPorCat[c.key])}</span>)}
            </div>
          </div>
          <Table headers={['Fecha', 'Descripción', 'Rubro', 'Proveedor', 'Cat.', 'Comprobante', 'Monto', '']}>
            {gastos.map((g) => (
              <tr key={g.id} className="hover:bg-slate-50">
                <Td>{fmtDate(g.fecha)}</Td>
                <Td className="font-medium max-w-xs truncate">{g.descripcion}</Td>
                <Td className="text-slate-500">{g.rubros?.nombre || '—'}</Td>
                <Td className="text-slate-500">{g.proveedores?.nombre || '—'}</Td>
                <Td><Badge color={g.categoria === 'A' ? 'teal' : g.categoria === 'B' ? 'blue' : g.categoria === 'C' ? 'purple' : 'orange'}>{g.categoria}</Badge></Td>
                <Td className="text-slate-400 text-xs">{g.comprobante || '—'}</Td>
                <Td className="font-semibold text-right">{fmtMoney(Number(g.monto))}</Td>
                <Td>{abierta && <button onClick={() => quitarGasto(g)} title="Quitar del período" className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>}</Td>
              </tr>
            ))}
            {gastos.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-400 py-10">Sin gastos cargados en este período.</Td></tr>}
          </Table>
        </Card>
      ) : tab === 'cupones' ? (
        <Card>
          {cupones.length === 0 ? (
            <EmptyState icon={<Receipt size={28} />} title="Todavía no se generaron cupones" subtitle='Cargá los gastos y usá "Generar cupones" o "Cerrar período".' />
          ) : (
            <Table headers={['UF', 'Depto / Propietario', 'A', 'B', 'C', 'D', 'Saldo ant.', 'Intereses', 'Total 1º venc.', 'Total 2º venc.', 'Estado', '']}>
              {cupones.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{String(c.unidades?.uf ?? '').padStart(3, '0')}</Td>
                  <Td><span className="font-medium">{c.unidades?.depto}</span><span className="text-slate-400 text-xs block">{c.unidades?.propietario}</span></Td>
                  <Td className="text-xs">{fmtMoney(Number(c.monto_a))}</Td>
                  <Td className="text-xs">{fmtMoney(Number(c.monto_b))}</Td>
                  <Td className="text-xs">{fmtMoney(Number(c.monto_c))}</Td>
                  <Td className="text-xs">{fmtMoney(Number(c.monto_d))}</Td>
                  <Td className={`text-xs ${Number(c.saldo_anterior) > 0 ? 'text-red-500' : Number(c.saldo_anterior) < 0 ? 'text-emerald-600' : ''}`}>{fmtMoney(Number(c.saldo_anterior))}</Td>
                  <Td className="text-xs">{fmtMoney(Number(c.intereses))}</Td>
                  <Td className="font-semibold">{fmtMoney(Number(c.total))}</Td>
                  <Td className="text-slate-500">{fmtMoney(Number(c.total_2do_venc))}</Td>
                  <Td><Badge color={c.estado === 'pagado' ? 'green' : c.estado === 'parcial' ? 'amber' : 'slate'}>{c.estado}</Badge></Td>
                  <Td>{!abierta && c.estado !== 'pagado' && <Button size="sm" variant="secondary" onClick={() => abrirPago(c)}>Cobrar</Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          {pagos.length === 0 ? (
            <EmptyState icon={<CheckCircle2 size={28} />} title="Sin cobranzas registradas" subtitle="Registrá los pagos desde la pestaña Cupones (botón Cobrar)." />
          ) : (
            <Table headers={['Fecha', 'UF', 'Propietario', 'Método', 'Comprobante', 'Monto', 'Registró', '']}>
              {pagos.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>{fmtDate(p.fecha)}</Td>
                  <Td className="font-mono text-xs">{String(p.unidades?.uf ?? '').padStart(3, '0')}</Td>
                  <Td>{p.unidades?.propietario || p.unidades?.depto}</Td>
                  <Td className="capitalize">{p.metodo}</Td>
                  <Td className="text-slate-400 text-xs">{p.comprobante || '—'}</Td>
                  <Td className="font-semibold text-emerald-600">{fmtMoney(Number(p.monto))}</Td>
                  <Td className="text-slate-400 text-xs">{p.registrado_por || '—'}</Td>
                  <Td><button onClick={() => borrarPago(p)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* Modal nuevo gasto */}
      <GastoModal open={gastoModal} onClose={() => setGastoModal(false)}
        consorcioId={liq.consorcio_id} liquidacionId={liq.id} onSaved={loadAll} />

      {/* Modal cobrar cupón */}
      <Modal open={!!pagoModal} onClose={() => setPagoModal(null)} title={`Cobrar UF ${pagoModal?.unidades?.uf} · ${pagoModal?.unidades?.depto}`}>
        {pagoModal && (
          <>
            <div className="bg-slate-50 rounded-lg p-3 text-sm mb-4 space-y-1">
              <p className="flex justify-between"><span className="text-slate-500">Total 1º vencimiento</span><b>{fmtMoney(Number(pagoModal.total))}</b></p>
              <p className="flex justify-between"><span className="text-slate-500">Total 2º vencimiento</span><b>{fmtMoney(Number(pagoModal.total_2do_venc))}</b></p>
              <p className="flex justify-between"><span className="text-slate-500">Ya cobrado</span><b className="text-emerald-600">{fmtMoney(pagos.filter((p) => p.cupon_id === pagoModal.id).reduce((a, p) => a + Number(p.monto), 0))}</b></p>
              <p className="text-xs text-slate-400 pt-1">Hoy corresponde: {fmtMoney(montoEsperado(pagoModal, liq.fecha_vencimiento_1, liq.fecha_vencimiento_2).monto)} ({montoEsperado(pagoModal, liq.fecha_vencimiento_1, liq.fecha_vencimiento_2).vencimiento})</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Fecha" type="date" value={pagoForm.fecha} onChange={(v) => setPagoForm({ ...pagoForm, fecha: v })} />
              <Input label="Monto" type="number" step="0.01" value={pagoForm.monto} onChange={(v) => setPagoForm({ ...pagoForm, monto: v })} required />
              <Select label="Método" value={pagoForm.metodo} onChange={(v) => setPagoForm({ ...pagoForm, metodo: v })}
                options={[{ value: 'transferencia', label: 'Transferencia' }, { value: 'efectivo', label: 'Efectivo' }, { value: 'cheque', label: 'Cheque' }, { value: 'debito', label: 'Débito' }, { value: 'tarjeta', label: 'Tarjeta' }]} />
              <Input label="Comprobante" value={pagoForm.comprobante} onChange={(v) => setPagoForm({ ...pagoForm, comprobante: v })} />
            </div>
            <div className="mt-4"><Textarea label="Observaciones" value={pagoForm.observaciones} onChange={(v) => setPagoForm({ ...pagoForm, observaciones: v })} rows={2} /></div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" onClick={() => setPagoModal(null)}>Cancelar</Button>
              <Button onClick={guardarPago} disabled={busy}>Registrar pago</Button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog open={!!confirm} title={confirm?.title || ''} message={confirm?.message || ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const a = confirm?.action; setConfirm(null); if (a) run(a); }} />
    </div>
  );
}

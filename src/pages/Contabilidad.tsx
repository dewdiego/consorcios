import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, BarChart3, Download, Landmark, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { supabase, type Conciliacion, type Cuenta, type Movimiento, type OrdenPago, type Proveedor, type Retencion } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { exportCSV, fmtDate, fmtMoney, hoyISO, periodoActual, round2 } from '@/lib/engine';

/*
  Contabilidad del consorcio (caja y bancos).
  - Cuentas: caja + bancos, con saldo inicial a una fecha. Una es la predeterminada: ahí caen los cobros y pagos que no indican cuenta.
  - Movimientos: ingresos (cobranzas) y egresos (OP, sueldos, retenciones) se generan solos desde las otras pantallas;
    acá se cargan los manuales, las transferencias entre cuentas y los ajustes.
  - Saldos: posición por cuenta en el período + posición financiera (disponible, a cobrar, a pagar).
  - Conciliaciones: tilde contra el extracto del banco, por cuenta y período.
  - Retenciones: practicadas a proveedores; al depositarlas generan el egreso.
*/

const ORIGEN_LABEL: Record<string, string> = { manual: 'MANUAL', pago: 'COBRO', orden_pago: 'PAGO', sueldo: 'SUELDO', transferencia: 'TRANSF.', retencion: 'RETENCIÓN', ajuste: 'AJUSTE' };
const ORIGEN_COLOR: Record<string, 'green' | 'purple' | 'blue' | 'slate' | 'amber' | 'red' | 'teal'> = { manual: 'slate', pago: 'green', orden_pago: 'purple', sueldo: 'blue', transferencia: 'amber', retencion: 'red', ajuste: 'slate' };
const TIPOS_RET = [{ value: 'ganancias', label: 'Ganancias' }, { value: 'iibb', label: 'IIBB' }, { value: 'suss', label: 'SUSS' }, { value: 'iva', label: 'IVA' }];
const signo = (m: Movimiento) => (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto));

export function Contabilidad() {
  const { consorcio, usuario } = useApp();
  const [tab, setTab] = useState('movimientos');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [periodo, setPeriodo] = useState(periodoActual());
  const [cuentaSel, setCuentaSel] = useState('');

  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [retenciones, setRetenciones] = useState<Retencion[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [ops, setOps] = useState<OrdenPago[]>([]);
  const [conciliaciones, setConciliaciones] = useState<Conciliacion[]>([]);
  const [aCobrar, setACobrar] = useState(0);
  const [gastosImpagos, setGastosImpagos] = useState(0);

  const [movModal, setMovModal] = useState(false);
  const [movForm, setMovForm] = useState({ cuenta_id: '', fecha: hoyISO(), tipo: 'ingreso', concepto: '', monto: '', comprobante: '' });
  const [trfModal, setTrfModal] = useState(false);
  const [trfForm, setTrfForm] = useState({ origen: '', destino: '', fecha: hoyISO(), monto: '', concepto: '' });
  const [ctaModal, setCtaModal] = useState(false);
  const [ctaEdit, setCtaEdit] = useState<Cuenta | null>(null);
  const [ctaForm, setCtaForm] = useState({ nombre: '', tipo: 'caja', banco: '', cbu: '', saldo_inicial: '0', fecha_saldo_inicial: hoyISO(), predeterminada: false });
  const [retModal, setRetModal] = useState(false);
  const [retForm, setRetForm] = useState({ proveedor_id: '', orden_pago_id: '', tipo: 'ganancias', base: '', alicuota: '', monto: '', fecha: hoyISO(), certificado: '' });
  const [depModal, setDepModal] = useState<Retencion | null>(null);
  const [depForm, setDepForm] = useState({ cuenta_id: '', fecha: hoyISO() });
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [extracto, setExtracto] = useState('');

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [m, c, r, p, o, co, cu, gi] = await Promise.all([
      supabase.from('movimientos').select('*, cuentas(*)').eq('consorcio_id', consorcio.id).order('fecha').order('created_at').limit(5000),
      supabase.from('cuentas').select('*').eq('consorcio_id', consorcio.id).order('predeterminada', { ascending: false }).order('nombre'),
      supabase.from('retenciones').select('*, proveedores(*)').eq('consorcio_id', consorcio.id).order('fecha', { ascending: false }),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('ordenes_pago').select('*, proveedores(*)').eq('consorcio_id', consorcio.id).order('numero', { ascending: false }),
      supabase.from('conciliaciones').select('*').eq('consorcio_id', consorcio.id),
      supabase.from('cupones').select('id, total').eq('consorcio_id', consorcio.id).neq('estado', 'pagado'),
      supabase.from('gastos').select('monto').eq('consorcio_id', consorcio.id).eq('pagado', false).is('orden_pago_id', null),
    ]);
    setMovs((m.data as Movimiento[]) || []);
    setCuentas((c.data as Cuenta[]) || []);
    setRetenciones((r.data as Retencion[]) || []);
    setProveedores((p.data as Proveedor[]) || []);
    setOps((o.data as OrdenPago[]) || []);
    setConciliaciones((co.data as Conciliacion[]) || []);
    setGastosImpagos(round2((gi.data || []).reduce((a, g) => a + Number(g.monto), 0)));
    // A cobrar: cupones no pagados menos lo ya cobrado a cuenta
    const ids = (cu.data || []).map((x) => x.id);
    let cobradoParcial = 0;
    if (ids.length) {
      const { data: pg } = await supabase.from('pagos').select('monto').in('cupon_id', ids);
      cobradoParcial = (pg || []).reduce((a, x) => a + Number(x.monto), 0);
    }
    setACobrar(round2((cu.data || []).reduce((a, x) => a + Number(x.total), 0) - cobradoParcial));
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);
  useEffect(() => { if (!cuentaSel && cuentas.length && tab === 'conciliaciones') setCuentaSel(cuentas.find((c) => c.tipo === 'banco')?.id || cuentas[0].id); }, [cuentas, tab]);

  const run = async (fn: () => Promise<string | void>) => {
    try { const r = await fn(); if (r) setMsg(r); await load(); } catch (e) { setMsg(`Error: ${(e as Error).message}`); }
  };

  // ---------- Cálculos ----------
  const desde = `${periodo}-01`, hasta = `${periodo}-31`;
  /** Saldo de una cuenta al inicio de una fecha (sin incluirla). */
  const saldoCuentaAl = (c: Cuenta, fecha: string) =>
    round2((fecha > c.fecha_saldo_inicial ? Number(c.saldo_inicial) : 0)
      + movs.filter((m) => m.cuenta_id === c.id && m.fecha >= c.fecha_saldo_inicial && m.fecha < fecha).reduce((a, m) => a + signo(m), 0));
  const movsCuenta = (cid: string | null, d = desde, h = hasta) =>
    movs.filter((m) => (cid ? m.cuenta_id === cid : !m.cuenta_id) && m.fecha >= d && m.fecha <= h);

  const resumenCuentas = useMemo(() => cuentas.map((c) => {
    const inicial = saldoCuentaAl(c, desde);
    const del = movsCuenta(c.id);
    const ing = round2(del.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0));
    const egr = round2(del.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0));
    return { c, inicial, ing, egr, final: round2(inicial + ing - egr) };
  }), [cuentas, movs, periodo]);
  const sinCuenta = movs.filter((m) => !m.cuenta_id);
  const totalDisponible = round2(resumenCuentas.reduce((a, r) => a + r.final, 0));
  const opsPendientes = round2(ops.filter((o) => o.estado === 'pendiente').reduce((a, o) => a + Number(o.monto), 0));
  const retPendientes = round2(retenciones.filter((r) => r.estado === 'pendiente').reduce((a, r) => a + Number(r.monto), 0));

  // Movimientos tab: listado tipo extracto con saldo acumulado
  const cuentaMov = cuentas.find((c) => c.id === cuentaSel) || null;
  const listaMovs = useMemo(() => {
    const base = cuentaSel === 'sin' ? movsCuenta(null) : cuentaSel ? movsCuenta(cuentaSel) : movs.filter((m) => m.fecha >= desde && m.fecha <= hasta);
    return base.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.created_at.localeCompare(b.created_at));
  }, [movs, cuentaSel, periodo]);
  const saldoInicialLista = cuentaMov ? saldoCuentaAl(cuentaMov, desde) : cuentaSel === 'sin' ? 0 : round2(resumenCuentas.reduce((a, r) => a + r.inicial, 0));
  let acumulado = saldoInicialLista;
  const totIng = round2(listaMovs.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0));
  const totEgr = round2(listaMovs.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0));

  // ---------- Acciones ----------
  const crearMov = () => run(async () => {
    const monto = parseFloat(movForm.monto);
    if (!consorcio || !movForm.concepto.trim() || !monto || monto <= 0) throw new Error('Completá concepto y monto.');
    const { error } = await supabase.from('movimientos').insert({
      consorcio_id: consorcio.id, cuenta_id: movForm.cuenta_id || null, fecha: movForm.fecha, tipo: movForm.tipo,
      concepto: movForm.concepto.trim(), monto, origen: movForm.tipo === 'ajuste' ? 'ajuste' : 'manual', comprobante: movForm.comprobante || null,
    });
    if (error) throw new Error(error.message);
    setMovModal(false); setMovForm({ cuenta_id: '', fecha: hoyISO(), tipo: 'ingreso', concepto: '', monto: '', comprobante: '' });
    return 'Movimiento cargado.';
  });

  const crearTransferencia = () => run(async () => {
    const monto = parseFloat(trfForm.monto);
    if (!consorcio || !trfForm.origen || !trfForm.destino || !monto || monto <= 0) throw new Error('Elegí cuenta de origen, destino y monto.');
    if (trfForm.origen === trfForm.destino) throw new Error('Origen y destino tienen que ser cuentas distintas.');
    const id = crypto.randomUUID();
    const o = cuentas.find((c) => c.id === trfForm.origen)!, d = cuentas.find((c) => c.id === trfForm.destino)!;
    const concepto = trfForm.concepto.trim() || `Transferencia ${o.nombre} → ${d.nombre}`;
    const { error } = await supabase.from('movimientos').insert([
      { consorcio_id: consorcio.id, cuenta_id: o.id, fecha: trfForm.fecha, tipo: 'egreso', concepto, monto, origen: 'transferencia', origen_id: id },
      { consorcio_id: consorcio.id, cuenta_id: d.id, fecha: trfForm.fecha, tipo: 'ingreso', concepto, monto, origen: 'transferencia', origen_id: id },
    ]);
    if (error) throw new Error(error.message);
    setTrfModal(false); setTrfForm({ origen: '', destino: '', fecha: hoyISO(), monto: '', concepto: '' });
    return 'Transferencia registrada en las dos cuentas.';
  });

  const borrarMov = (m: Movimiento) => {
    if (!['manual', 'transferencia', 'ajuste'].includes(m.origen)) { setMsg('Este movimiento se generó desde un cobro, pago u orden: eliminalo desde esa pantalla.'); return; }
    setConfirm({
      title: 'Eliminar movimiento', message: m.origen === 'transferencia' ? 'Se eliminan las dos patas de la transferencia. ¿Continuar?' : `¿Eliminar "${m.concepto}"?`,
      action: async () => {
        const q = m.origen === 'transferencia' && m.origen_id ? supabase.from('movimientos').delete().eq('origen_id', m.origen_id) : supabase.from('movimientos').delete().eq('id', m.id);
        const { error } = await q; if (error) throw new Error(error.message);
      },
    });
  };

  const cambiarCuenta = (m: Movimiento, cid: string) => run(async () => {
    await supabase.from('movimientos').update({ cuenta_id: cid || null }).eq('id', m.id);
  });

  const toggleConciliado = (m: Movimiento) => run(async () => {
    await supabase.from('movimientos').update({ conciliado: !m.conciliado, fecha_conciliado: m.conciliado ? null : hoyISO() }).eq('id', m.id);
  });
  const conciliarTodos = (lista: Movimiento[], valor: boolean) => run(async () => {
    const ids = lista.filter((m) => m.conciliado !== valor).map((m) => m.id);
    if (ids.length) await supabase.from('movimientos').update({ conciliado: valor, fecha_conciliado: valor ? hoyISO() : null }).in('id', ids);
  });
  const guardarExtracto = (cid: string, valor: string, cerrada?: boolean) => run(async () => {
    if (!consorcio) return;
    const saldo = valor === '' ? null : parseFloat(valor);
    const { error } = await supabase.from('conciliaciones').upsert({ consorcio_id: consorcio.id, cuenta_id: cid, periodo, saldo_extracto: saldo, ...(cerrada !== undefined ? { cerrada } : {}) }, { onConflict: 'cuenta_id,periodo' });
    if (error) throw new Error(error.message);
    if (cerrada) return 'Conciliación cerrada.';
  });

  const abrirCuenta = (c?: Cuenta) => {
    setCtaEdit(c || null);
    setCtaForm(c ? { nombre: c.nombre, tipo: c.tipo, banco: c.banco || '', cbu: c.cbu || '', saldo_inicial: String(c.saldo_inicial), fecha_saldo_inicial: c.fecha_saldo_inicial, predeterminada: c.predeterminada }
      : { nombre: '', tipo: cuentas.length ? 'banco' : 'caja', banco: '', cbu: '', saldo_inicial: '0', fecha_saldo_inicial: hoyISO(), predeterminada: cuentas.length === 0 });
    setCtaModal(true);
  };
  const guardarCuenta = () => run(async () => {
    if (!consorcio || !ctaForm.nombre.trim()) throw new Error('Poné un nombre a la cuenta.');
    const payload = {
      consorcio_id: consorcio.id, nombre: ctaForm.nombre.trim(), tipo: ctaForm.tipo, banco: ctaForm.banco || null, cbu: ctaForm.cbu || null,
      saldo_inicial: parseFloat(ctaForm.saldo_inicial) || 0, fecha_saldo_inicial: ctaForm.fecha_saldo_inicial || hoyISO(), predeterminada: ctaForm.predeterminada,
    };
    if (payload.predeterminada) await supabase.from('cuentas').update({ predeterminada: false }).eq('consorcio_id', consorcio.id);
    const { error } = ctaEdit ? await supabase.from('cuentas').update(payload).eq('id', ctaEdit.id) : await supabase.from('cuentas').insert(payload);
    if (error) throw new Error(error.message);
    setCtaModal(false);
  });
  const hacerPredeterminada = (c: Cuenta) => run(async () => {
    if (!consorcio) return;
    await supabase.from('cuentas').update({ predeterminada: false }).eq('consorcio_id', consorcio.id);
    await supabase.from('cuentas').update({ predeterminada: true }).eq('id', c.id);
  });
  const borrarCuenta = (c: Cuenta) => {
    const usada = movs.some((m) => m.cuenta_id === c.id);
    setConfirm({
      title: usada ? 'Desactivar cuenta' : 'Eliminar cuenta',
      message: usada ? `"${c.nombre}" tiene movimientos, así que no se puede borrar: se desactiva y deja de ofrecerse para nuevos cobros/pagos.` : `¿Eliminar la cuenta "${c.nombre}"?`,
      action: async () => {
        const { error } = usada ? await supabase.from('cuentas').update({ activa: false, predeterminada: false }).eq('id', c.id) : await supabase.from('cuentas').delete().eq('id', c.id);
        if (error) throw new Error(error.message);
      },
    });
  };

  const retMonto = () => {
    const b = parseFloat(retForm.base), a = parseFloat(retForm.alicuota);
    return b && a ? round2(b * a / 100) : parseFloat(retForm.monto) || 0;
  };
  const crearRet = () => run(async () => {
    const monto = retMonto();
    if (!consorcio || !monto) throw new Error('Ingresá base y alícuota, o el monto.');
    const { error } = await supabase.from('retenciones').insert({
      consorcio_id: consorcio.id, proveedor_id: retForm.proveedor_id || null, orden_pago_id: retForm.orden_pago_id || null, tipo: retForm.tipo,
      base: parseFloat(retForm.base) || null, alicuota: parseFloat(retForm.alicuota) || null, monto, fecha: retForm.fecha, certificado: retForm.certificado || null,
    });
    if (error) throw new Error(error.message);
    setRetModal(false); setRetForm({ proveedor_id: '', orden_pago_id: '', tipo: 'ganancias', base: '', alicuota: '', monto: '', fecha: hoyISO(), certificado: '' });
    return 'Retención registrada (pendiente de depósito).';
  });
  const depositar = () => run(async () => {
    if (!consorcio || !depModal) return;
    const { data: mov, error } = await supabase.from('movimientos').insert({
      consorcio_id: consorcio.id, cuenta_id: depForm.cuenta_id || null, fecha: depForm.fecha, tipo: 'egreso',
      concepto: `Depósito retención ${depModal.tipo.toUpperCase()} — ${depModal.proveedores?.nombre || 'proveedor'}${depModal.certificado ? ` (cert. ${depModal.certificado})` : ''}`,
      monto: Number(depModal.monto), origen: 'retencion', origen_id: depModal.id,
    }).select().single();
    if (error) throw new Error(error.message);
    await supabase.from('retenciones').update({ estado: 'depositada', depositada_at: depForm.fecha, movimiento_id: mov.id }).eq('id', depModal.id);
    setDepModal(null);
    return 'Retención depositada: se generó el egreso.';
  });
  const borrarRet = (r: Retencion) => setConfirm({
    title: 'Eliminar retención', message: r.estado === 'depositada' ? 'Está depositada: también se elimina el egreso de caja. ¿Continuar?' : `¿Eliminar la retención de ${fmtMoney(Number(r.monto))}?`,
    action: async () => {
      if (r.movimiento_id) await supabase.from('movimientos').delete().eq('id', r.movimiento_id);
      const { error } = await supabase.from('retenciones').delete().eq('id', r.id); if (error) throw new Error(error.message);
    },
  });

  if (!consorcio) return null;
  const optCuentas = cuentas.filter((c) => c.activa).map((c) => ({ value: c.id, label: `${c.nombre}${c.tipo === 'banco' && c.cbu ? ` - ${c.cbu}` : ''}` }));
  const filtroPeriodo = <div className="w-40"><Input label="Período" type="month" value={periodo} onChange={setPeriodo} /></div>;

  return (
    <div>
      <PageHeader title={`Contabilidad · ${consorcio.nombre}`} subtitle="Caja y bancos. Cobranzas, pagos a proveedores, sueldos y retenciones impactan acá automáticamente."
        action={
          tab === 'movimientos' ? <div className="flex gap-2"><Button variant="secondary" onClick={() => setTrfModal(true)} disabled={cuentas.length < 2}><ArrowLeftRight size={15} /> Transferencia</Button><Button onClick={() => setMovModal(true)}><Plus size={16} /> Movimiento</Button></div>
            : tab === 'cuentas' ? <Button onClick={() => abrirCuenta()}><Plus size={16} /> Nueva cuenta</Button>
            : tab === 'retenciones' ? <Button onClick={() => setRetModal(true)}><Plus size={16} /> Nueva retención</Button>
            : null
        } />

      {msg && <div className={`mb-4 text-sm px-4 py-2.5 rounded-lg ${msg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg} <button className="ml-2 underline" onClick={() => setMsg('')}>cerrar</button></div>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'movimientos', label: 'Movimientos' },
        { key: 'saldos', label: 'Saldos' },
        { key: 'cuentas', label: 'Cuentas', badge: cuentas.filter((c) => c.activa).length },
        { key: 'conciliaciones', label: 'Conciliaciones', badge: movs.filter((m) => !m.conciliado && m.cuenta_id).length },
        { key: 'retenciones', label: 'Retenciones', badge: retenciones.filter((r) => r.estado === 'pendiente').length || undefined },
      ]} />

      {loading ? <Spinner /> : cuentas.length === 0 && tab !== 'cuentas' ? (
        <Card><EmptyState icon={<Landmark size={28} />} title="Primero creá las cuentas del consorcio" subtitle="Al menos una caja o cuenta bancaria. La predeterminada recibe los cobros y pagos automáticamente." /><div className="text-center pb-4"><Button onClick={() => { setTab('cuentas'); abrirCuenta(); }}><Plus size={16} /> Crear cuenta</Button></div></Card>
      ) : tab === 'movimientos' ? (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-end gap-4">
              {filtroPeriodo}
              <div className="w-80"><Select label="Cuenta" value={cuentaSel} onChange={setCuentaSel} placeholder="Todas las cuentas"
                options={[...optCuentas, ...(sinCuenta.length ? [{ value: 'sin', label: `Sin cuenta asignada (${sinCuenta.length})` }] : [])]} /></div>
              <Button variant="secondary" size="sm" onClick={() => exportCSV(`movimientos-${consorcio.nombre}-${periodo}.csv`, ['Fecha', 'Tipo', 'Descripción', 'Cuenta', 'Ingreso', 'Egreso'],
                listaMovs.map((m) => [m.fecha, ORIGEN_LABEL[m.origen] || m.origen, m.concepto, m.cuentas?.nombre || '', m.tipo === 'ingreso' ? Number(m.monto) : '', m.tipo === 'egreso' ? Number(m.monto) : '']))}><Download size={14} /> Exportar</Button>
            </div>
          </Card>
          {sinCuenta.length > 0 && cuentaSel !== 'sin' && <div className="mb-4 text-sm px-4 py-2.5 rounded-lg bg-amber-50 text-amber-800">Hay {sinCuenta.length} movimientos sin cuenta asignada que no suman en ningún saldo. <button className="underline font-medium" onClick={() => setCuentaSel('sin')}>Verlos y asignarles cuenta</button>.</div>}
          <Card>
            <Table headers={['Fecha', 'Tipo', 'Descripción', 'Cuenta', 'Ingreso', 'Egreso', 'Saldo', '']}
              footer={<tr className="bg-slate-50 font-bold"><Td colSpan={4} className="text-right">Totales del período</Td><Td className="text-emerald-600">{fmtMoney(totIng)}</Td><Td className="text-red-500">{fmtMoney(totEgr)}</Td><Td>{fmtMoney(round2(saldoInicialLista + totIng - totEgr))}</Td><Td /></tr>}>
              {cuentaSel !== 'sin' && <tr className="bg-slate-50/60"><Td>{fmtDate(desde)}</Td><Td><Badge color="teal">BALANCE</Badge></Td><Td className="font-medium">Saldo inicial</Td><Td /><Td /><Td /><Td className="font-semibold">{fmtMoney(saldoInicialLista)}</Td><Td /></tr>}
              {listaMovs.map((m) => {
                acumulado = round2(acumulado + signo(m));
                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <Td className="whitespace-nowrap">{fmtDate(m.fecha)}</Td>
                    <Td><Badge color={ORIGEN_COLOR[m.origen] || 'slate'}>{ORIGEN_LABEL[m.origen] || m.origen}</Badge></Td>
                    <Td className="max-w-md"><div className="truncate font-medium">{m.concepto}</div>{m.comprobante && <div className="text-xs text-slate-400">Comp. {m.comprobante}</div>}</Td>
                    <Td>
                      <select value={m.cuenta_id || ''} onChange={(e) => cambiarCuenta(m, e.target.value)} className={`text-xs border rounded px-1.5 py-1 bg-white ${m.cuenta_id ? 'border-slate-200 text-slate-600' : 'border-amber-300 text-amber-700'}`}>
                        <option value="">Sin cuenta</option>
                        {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </Td>
                    <Td className="text-emerald-600 font-medium whitespace-nowrap">{m.tipo === 'ingreso' ? fmtMoney(Number(m.monto)) : ''}</Td>
                    <Td className="text-red-500 font-medium whitespace-nowrap">{m.tipo === 'egreso' ? fmtMoney(Number(m.monto)) : ''}</Td>
                    <Td className={`whitespace-nowrap ${acumulado < 0 ? 'text-red-500' : ''}`}>{cuentaSel !== 'sin' ? fmtMoney(acumulado) : ''}</Td>
                    <Td>{['manual', 'transferencia', 'ajuste'].includes(m.origen) && <button onClick={() => borrarMov(m)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>}</Td>
                  </tr>
                );
              })}
              {listaMovs.length === 0 && <tr><Td colSpan={8} className="text-center text-slate-400 py-8">Sin movimientos en {periodo}</Td></tr>}
            </Table>
          </Card>
        </>
      ) : tab === 'saldos' ? (
        <>
          <Card className="mb-4">{filtroPeriodo}</Card>
          <Card className="mb-4">
            <h3 className="font-semibold text-slate-700 mb-3">Saldos por cuenta · {periodo}</h3>
            <Table headers={['Cuenta', 'Tipo', 'Saldo inicial', 'Ingresos', 'Egresos', 'Saldo final']}
              footer={<tr className="bg-slate-50 font-bold"><Td colSpan={2}>Total disponible</Td><Td>{fmtMoney(round2(resumenCuentas.reduce((a, r) => a + r.inicial, 0)))}</Td><Td className="text-emerald-600">{fmtMoney(round2(resumenCuentas.reduce((a, r) => a + r.ing, 0)))}</Td><Td className="text-red-500">{fmtMoney(round2(resumenCuentas.reduce((a, r) => a + r.egr, 0)))}</Td><Td>{fmtMoney(totalDisponible)}</Td></tr>}>
              {resumenCuentas.map(({ c, inicial, ing, egr, final }) => (
                <tr key={c.id} className={`hover:bg-slate-50 ${!c.activa ? 'opacity-50' : ''}`}>
                  <Td className="font-medium">{c.nombre}{c.predeterminada && <Star size={12} className="inline ml-1.5 text-amber-400 fill-amber-400" />}</Td>
                  <Td className="capitalize text-slate-500">{c.tipo}{c.banco ? ` · ${c.banco}` : ''}</Td>
                  <Td>{fmtMoney(inicial)}</Td>
                  <Td className="text-emerald-600">{fmtMoney(ing)}</Td>
                  <Td className="text-red-500">{fmtMoney(egr)}</Td>
                  <Td className={`font-semibold ${final < 0 ? 'text-red-500' : ''}`}>{fmtMoney(final)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card>
            <h3 className="font-semibold text-slate-700 mb-1">Posición financiera (hoy)</h3>
            <p className="text-xs text-slate-400 mb-4">Lo que hay en cuentas, lo que falta cobrar de expensas y lo que falta pagar.</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              {[
                { l: 'Disponible en cuentas', v: round2(cuentas.reduce((a, c) => a + saldoCuentaAl(c, '9999-12-31'), 0)), c: 'text-navy' },
                { l: 'A cobrar (expensas)', v: aCobrar, c: 'text-emerald-600' },
                { l: 'A pagar (OP pendientes)', v: opsPendientes, c: 'text-red-500' },
                { l: 'Gastos impagos sin OP', v: gastosImpagos, c: 'text-red-500' },
                { l: 'Retenciones a depositar', v: retPendientes, c: 'text-red-500' },
              ].map((k) => <div key={k.l} className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">{k.l}</div><div className={`text-lg font-bold ${k.c}`}>{fmtMoney(k.v)}</div></div>)}
            </div>
            {(() => { const disp = round2(cuentas.reduce((a, c) => a + saldoCuentaAl(c, '9999-12-31'), 0)); const proy = round2(disp + aCobrar - opsPendientes - gastosImpagos - retPendientes); return (
              <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${proy < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>Resultado proyectado (disponible + a cobrar − a pagar): <b>{fmtMoney(proy)}</b>{proy < 0 && ' — el consorcio no cubre sus compromisos con lo que tiene y lo que le deben.'}</div>
            ); })()}
          </Card>
        </>
      ) : tab === 'cuentas' ? (
        cuentas.length === 0 ? <Card><EmptyState icon={<Landmark size={28} />} title="Sin cuentas" subtitle="Creá la caja y las cuentas bancarias del consorcio." /></Card> : (
          <Card>
            <Table headers={['', 'Nombre', 'Tipo', 'Banco', 'CBU', 'Saldo inicial', 'Saldo actual', 'Estado', '']}>
              {cuentas.map((c) => {
                const saldo = saldoCuentaAl(c, '9999-12-31');
                return (
                  <tr key={c.id} className={`hover:bg-slate-50 ${!c.activa ? 'opacity-50' : ''}`}>
                    <Td><button title={c.predeterminada ? 'Cuenta predeterminada' : 'Hacer predeterminada'} onClick={() => !c.predeterminada && c.activa && hacerPredeterminada(c)} className="p-1"><Star size={15} className={c.predeterminada ? 'text-amber-400 fill-amber-400' : 'text-slate-300'} /></button></Td>
                    <Td className="font-medium">{c.nombre}</Td>
                    <Td className="capitalize">{c.tipo}</Td>
                    <Td>{c.banco || '—'}</Td>
                    <Td className="font-mono text-xs">{c.cbu || '—'}</Td>
                    <Td>{fmtMoney(Number(c.saldo_inicial))}<div className="text-xs text-slate-400">al {fmtDate(c.fecha_saldo_inicial)}</div></Td>
                    <Td className={`font-semibold ${saldo < 0 ? 'text-red-500' : ''}`}>{fmtMoney(saldo)}</Td>
                    <Td><Badge color={c.activa ? 'green' : 'slate'}>{c.activa ? 'activa' : 'inactiva'}</Badge></Td>
                    <Td><div className="flex gap-1">
                      <button onClick={() => abrirCuenta(c)} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                      {c.activa ? <button onClick={() => borrarCuenta(c)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                        : <button onClick={() => run(async () => { await supabase.from('cuentas').update({ activa: true }).eq('id', c.id); })} className="text-xs text-teal-600 underline">reactivar</button>}
                    </div></Td>
                  </tr>
                );
              })}
            </Table>
            <p className="text-xs text-slate-400 mt-3">★ Predeterminada: recibe los cobros de expensas, pagos de OP y sueldos cuando no se indica otra cuenta.</p>
          </Card>
        )
      ) : tab === 'conciliaciones' ? (() => {
        const c = cuentas.find((x) => x.id === cuentaSel) || cuentas[0];
        if (!c) return null;
        const lista = movsCuenta(c.id);
        const inicial = saldoCuentaAl(c, desde);
        const conciliados = round2(lista.filter((m) => m.conciliado).reduce((a, m) => a + signo(m), 0));
        const saldoSistema = round2(inicial + lista.reduce((a, m) => a + signo(m), 0));
        const saldoConciliado = round2(inicial + conciliados);
        const conc = conciliaciones.find((x) => x.cuenta_id === c.id && x.periodo === periodo);
        const extractoVal = extracto !== '' ? extracto : conc?.saldo_extracto != null ? String(conc.saldo_extracto) : '';
        const ext = extractoVal === '' ? null : parseFloat(extractoVal);
        const dif = ext === null ? null : round2(saldoConciliado - ext);
        const pendientes = lista.filter((m) => !m.conciliado);
        return (
          <>
            <Card className="mb-4">
              <div className="flex flex-wrap items-end gap-4">
                {filtroPeriodo}
                <div className="w-80"><Select label="Cuenta" value={c.id} onChange={(v) => { setCuentaSel(v); setExtracto(''); }} options={optCuentas} /></div>
                <div className="w-52"><Input label="Saldo según extracto" type="number" step="0.01" value={extractoVal} onChange={(v) => { setExtracto(v); }} placeholder="Saldo al cierre del banco" /></div>
                <Button variant="secondary" size="sm" onClick={() => guardarExtracto(c.id, extractoVal)}>Guardar extracto</Button>
                {conc?.cerrada ? <Badge color="green">Conciliación cerrada</Badge> : <Button size="sm" disabled={dif !== 0} onClick={() => guardarExtracto(c.id, extractoVal, true)}>Cerrar conciliación</Button>}
              </div>
            </Card>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
              {[
                { l: 'Saldo inicial', v: inicial }, { l: 'Saldo sistema al cierre', v: saldoSistema },
                { l: 'Saldo conciliado (inicial + tildados)', v: saldoConciliado }, { l: 'Diferencia con extracto', v: dif, warn: dif !== null && dif !== 0 },
              ].map((k) => <div key={k.l} className={`rounded-lg border p-3 ${k.warn ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}><div className="text-xs text-slate-500">{k.l}</div><div className={`text-lg font-bold ${k.warn ? 'text-red-600' : ''}`}>{k.v === null ? '—' : fmtMoney(k.v)}</div></div>)}
            </div>
            {dif !== null && dif !== 0 && <div className="mb-4 text-sm px-4 py-2.5 rounded-lg bg-amber-50 text-amber-800">{dif > 0 ? 'El sistema tiene más que el banco: hay movimientos tildados que el banco todavía no acreditó/debitó, o falta cargar un débito (comisiones, impuestos).' : 'El banco tiene más que el sistema: falta registrar un ingreso (acreditación, cobro no cargado) o se tildó de más.'} Cargalo como movimiento manual en la pestaña Movimientos.</div>}
            <Card>
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-slate-500">{pendientes.length} sin conciliar de {lista.length}</span>
                <div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => conciliarTodos(lista, true)}>Tildar todos</Button><Button variant="secondary" size="sm" onClick={() => conciliarTodos(lista, false)}>Destildar todos</Button></div>
              </div>
              <Table headers={['✓', 'Fecha', 'Tipo', 'Concepto', 'Ingreso', 'Egreso', 'Conciliado el']}>
                {lista.map((m) => (
                  <tr key={m.id} className={`hover:bg-slate-50 ${m.conciliado ? '' : 'bg-amber-50/40'}`}>
                    <Td><input type="checkbox" className="rounded" checked={m.conciliado} onChange={() => toggleConciliado(m)} /></Td>
                    <Td className="whitespace-nowrap">{fmtDate(m.fecha)}</Td>
                    <Td><Badge color={ORIGEN_COLOR[m.origen] || 'slate'}>{ORIGEN_LABEL[m.origen] || m.origen}</Badge></Td>
                    <Td className="max-w-md truncate">{m.concepto}</Td>
                    <Td className="text-emerald-600">{m.tipo === 'ingreso' ? fmtMoney(Number(m.monto)) : ''}</Td>
                    <Td className="text-red-500">{m.tipo === 'egreso' ? fmtMoney(Number(m.monto)) : ''}</Td>
                    <Td className="text-xs text-slate-400">{m.fecha_conciliado ? fmtDate(m.fecha_conciliado) : ''}</Td>
                  </tr>
                ))}
                {lista.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-400 py-8">Sin movimientos en {c.nombre} para {periodo}</Td></tr>}
              </Table>
            </Card>
          </>
        );
      })() : (() => {
        const lista = retenciones.filter((r) => r.fecha >= desde && r.fecha <= hasta);
        const porTipo = TIPOS_RET.map((t) => ({ ...t, pend: round2(retenciones.filter((r) => r.tipo === t.value && r.estado === 'pendiente').reduce((a, r) => a + Number(r.monto), 0)), per: round2(lista.filter((r) => r.tipo === t.value).reduce((a, r) => a + Number(r.monto), 0)) }));
        return (
          <>
            <Card className="mb-4"><div className="flex flex-wrap items-end gap-4">{filtroPeriodo}
              <Button variant="secondary" size="sm" onClick={() => exportCSV(`retenciones-${consorcio.nombre}-${periodo}.csv`, ['Fecha', 'Tipo', 'Proveedor', 'Base', 'Alícuota', 'Monto', 'Certificado', 'Estado'],
                lista.map((r) => [r.fecha, r.tipo, r.proveedores?.nombre || '', r.base ?? '', r.alicuota ?? '', Number(r.monto), r.certificado || '', r.estado]))}><Download size={14} /> Exportar</Button></div></Card>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
              {porTipo.map((t) => <div key={t.value} className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{t.label} · practicadas en {periodo}</div><div className="text-lg font-bold">{fmtMoney(t.per)}</div><div className={`text-xs ${t.pend ? 'text-red-500' : 'text-slate-400'}`}>a depositar: {fmtMoney(t.pend)}</div></div>)}
            </div>
            <Card>
              <Table headers={['Fecha', 'Tipo', 'Proveedor', 'OP', 'Base', 'Alíc.', 'Monto', 'Certificado', 'Estado', '']}>
                {lista.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td className="whitespace-nowrap">{fmtDate(r.fecha)}</Td>
                    <Td className="uppercase font-medium">{r.tipo}</Td>
                    <Td>{r.proveedores?.nombre || '—'}</Td>
                    <Td className="text-slate-500">{(() => { const op = ops.find((o) => o.id === r.orden_pago_id); return op ? `#${op.numero}` : '—'; })()}</Td>
                    <Td>{r.base != null ? fmtMoney(Number(r.base)) : '—'}</Td>
                    <Td>{r.alicuota != null ? `${r.alicuota}%` : '—'}</Td>
                    <Td className="font-semibold">{fmtMoney(Number(r.monto))}</Td>
                    <Td className="text-slate-500">{r.certificado || '—'}</Td>
                    <Td><Badge color={r.estado === 'depositada' ? 'green' : 'amber'}>{r.estado === 'depositada' ? `depositada ${r.depositada_at ? fmtDate(r.depositada_at) : ''}` : 'pendiente'}</Badge></Td>
                    <Td><div className="flex gap-1 items-center">
                      {r.estado === 'pendiente' && <Button size="sm" onClick={() => { setDepForm({ cuenta_id: cuentas.find((c) => c.predeterminada)?.id || cuentas[0]?.id || '', fecha: hoyISO() }); setDepModal(r); }}>Depositar</Button>}
                      <button onClick={() => borrarRet(r)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div></Td>
                  </tr>
                ))}
                {lista.length === 0 && <tr><Td colSpan={10} className="text-center text-slate-400 py-8">Sin retenciones en {periodo}</Td></tr>}
              </Table>
            </Card>
          </>
        );
      })()}

      {/* ---------- Modales ---------- */}
      <Modal open={movModal} onClose={() => setMovModal(false)} title="Movimiento manual">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Tipo" value={movForm.tipo} onChange={(v) => setMovForm({ ...movForm, tipo: v })}
            options={[{ value: 'ingreso', label: 'Ingreso' }, { value: 'egreso', label: 'Egreso' }]} />
          <Select label="Cuenta" value={movForm.cuenta_id} onChange={(v) => setMovForm({ ...movForm, cuenta_id: v })} placeholder="— Elegir —" options={optCuentas} required />
          <Input label="Fecha" type="date" value={movForm.fecha} onChange={(v) => setMovForm({ ...movForm, fecha: v })} />
          <Input label="Monto" type="number" step="0.01" value={movForm.monto} onChange={(v) => setMovForm({ ...movForm, monto: v })} required />
          <div className="col-span-2"><Input label="Concepto" value={movForm.concepto} onChange={(v) => setMovForm({ ...movForm, concepto: v })} placeholder="Comisión bancaria / Impuesto débito-crédito / Ingreso extraordinario" required /></div>
          <div className="col-span-2"><Input label="Comprobante (opcional)" value={movForm.comprobante} onChange={(v) => setMovForm({ ...movForm, comprobante: v })} /></div>
        </div>
        <p className="text-xs text-slate-400 mt-3">Los cobros de expensas, pagos a proveedores y sueldos no se cargan acá: se generan solos desde sus pantallas.</p>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setMovModal(false)}>Cancelar</Button><Button onClick={crearMov}>Guardar</Button></div>
      </Modal>

      <Modal open={trfModal} onClose={() => setTrfModal(false)} title="Transferencia entre cuentas">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Desde" value={trfForm.origen} onChange={(v) => setTrfForm({ ...trfForm, origen: v })} placeholder="— Cuenta origen —" options={optCuentas} required />
          <Select label="Hacia" value={trfForm.destino} onChange={(v) => setTrfForm({ ...trfForm, destino: v })} placeholder="— Cuenta destino —" options={optCuentas} required />
          <Input label="Fecha" type="date" value={trfForm.fecha} onChange={(v) => setTrfForm({ ...trfForm, fecha: v })} />
          <Input label="Monto" type="number" step="0.01" value={trfForm.monto} onChange={(v) => setTrfForm({ ...trfForm, monto: v })} required />
          <div className="col-span-2"><Input label="Concepto (opcional)" value={trfForm.concepto} onChange={(v) => setTrfForm({ ...trfForm, concepto: v })} placeholder="Depósito de caja en banco" /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setTrfModal(false)}>Cancelar</Button><Button onClick={crearTransferencia}>Transferir</Button></div>
      </Modal>

      <Modal open={ctaModal} onClose={() => setCtaModal(false)} title={ctaEdit ? 'Editar cuenta' : 'Nueva cuenta'}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Nombre" value={ctaForm.nombre} onChange={(v) => setCtaForm({ ...ctaForm, nombre: v })} placeholder="Caja / Banco Ciudad" required />
          <Select label="Tipo" value={ctaForm.tipo} onChange={(v) => setCtaForm({ ...ctaForm, tipo: v })} options={[{ value: 'caja', label: 'Caja (efectivo)' }, { value: 'banco', label: 'Cuenta bancaria' }]} />
          {ctaForm.tipo === 'banco' && <>
            <Input label="Banco" value={ctaForm.banco} onChange={(v) => setCtaForm({ ...ctaForm, banco: v })} />
            <Input label="CBU / Nº de cuenta" value={ctaForm.cbu} onChange={(v) => setCtaForm({ ...ctaForm, cbu: v })} />
          </>}
          <Input label="Saldo inicial" type="number" step="0.01" value={ctaForm.saldo_inicial} onChange={(v) => setCtaForm({ ...ctaForm, saldo_inicial: v })} />
          <Input label="Saldo inicial al día" type="date" value={ctaForm.fecha_saldo_inicial} onChange={(v) => setCtaForm({ ...ctaForm, fecha_saldo_inicial: v })} />
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="rounded" checked={ctaForm.predeterminada} onChange={(e) => setCtaForm({ ...ctaForm, predeterminada: e.target.checked })} /> Cuenta predeterminada (recibe cobros y pagos automáticos)</label>
        </div>
        <p className="text-xs text-slate-400 mt-3">El saldo inicial es el que tenía la cuenta al día indicado; los movimientos anteriores a esa fecha no se suman.</p>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setCtaModal(false)}>Cancelar</Button><Button onClick={guardarCuenta}>Guardar</Button></div>
      </Modal>

      <Modal open={retModal} onClose={() => setRetModal(false)} title="Nueva retención">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Tipo" value={retForm.tipo} onChange={(v) => setRetForm({ ...retForm, tipo: v })} options={TIPOS_RET} />
          <Select label="Proveedor" value={retForm.proveedor_id} onChange={(v) => setRetForm({ ...retForm, proveedor_id: v, orden_pago_id: '' })} placeholder="— Elegir —" options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} />
          <div className="col-span-2"><Select label="Orden de pago (opcional)" value={retForm.orden_pago_id} placeholder="— Sin OP —"
            onChange={(v) => { const op = ops.find((o) => o.id === v); setRetForm({ ...retForm, orden_pago_id: v, base: op ? String(op.monto) : retForm.base }); }}
            options={ops.filter((o) => o.estado !== 'anulada' && (!retForm.proveedor_id || o.proveedor_id === retForm.proveedor_id)).map((o) => ({ value: o.id, label: `OP #${o.numero} · ${fmtDate(o.fecha)} · ${fmtMoney(Number(o.monto))}` }))} /></div>
          <Input label="Base imponible" type="number" step="0.01" value={retForm.base} onChange={(v) => setRetForm({ ...retForm, base: v })} />
          <Input label="Alícuota %" type="number" step="0.01" value={retForm.alicuota} onChange={(v) => setRetForm({ ...retForm, alicuota: v })} />
          <Input label={retForm.base && retForm.alicuota ? 'Monto (calculado)' : 'Monto'} type="number" step="0.01" value={retForm.base && retForm.alicuota ? String(retMonto()) : retForm.monto} onChange={(v) => setRetForm({ ...retForm, monto: v })} />
          <Input label="Fecha" type="date" value={retForm.fecha} onChange={(v) => setRetForm({ ...retForm, fecha: v })} />
          <div className="col-span-2"><Input label="N° certificado" value={retForm.certificado} onChange={(v) => setRetForm({ ...retForm, certificado: v })} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setRetModal(false)}>Cancelar</Button><Button onClick={crearRet}>Guardar</Button></div>
      </Modal>

      <Modal open={!!depModal} onClose={() => setDepModal(null)} title="Depositar retención">
        {depModal && <>
          <p className="text-sm text-slate-600 mb-4">{depModal.tipo.toUpperCase()} · {depModal.proveedores?.nombre || '—'} · <b>{fmtMoney(Number(depModal.monto))}</b></p>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Cuenta de salida" value={depForm.cuenta_id} onChange={(v) => setDepForm({ ...depForm, cuenta_id: v })} options={optCuentas} required />
            <Input label="Fecha de depósito" type="date" value={depForm.fecha} onChange={(v) => setDepForm({ ...depForm, fecha: v })} />
          </div>
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setDepModal(null)}>Cancelar</Button><Button onClick={depositar}>Confirmar depósito</Button></div>
        </>}
      </Modal>

      <ConfirmDialog open={!!confirm} title={confirm?.title || ''} message={confirm?.message || ''} onCancel={() => setConfirm(null)}
        onConfirm={async () => { if (!confirm) return; const a = confirm.action; setConfirm(null); await run(a); }} />
    </div>
  );
}

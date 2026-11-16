import { useEffect, useMemo, useState } from 'react';
import { Check, Link2, Plus, Trash2, X } from 'lucide-react';
import { supabase, type CobroNoIdentificado, type Cuenta, type Cupon, type Liquidacion, type PagoInformado, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td } from '@/components/ui';
import { actualizarEstadoCupon, cuentaPredeterminada, fmtDate, fmtMoney, hoyISO, montoEsperado, periodoLabel, registrarPago, round2 } from '@/lib/engine';
import { METODOS, ufTxt } from '@/lib/avisos';

const num = (s: string) => parseFloat(String(s).replace(',', '.')) || 0;

/** Cobranzas: carga masiva, pagos informados por los propietarios y cobros que todavía no se sabe de quién son. */
export function Cobranzas() {
  const { consorcio, usuario } = useApp();
  const [tab, setTab] = useState('masiva');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [liq, setLiq] = useState<Liquidacion | null>(null);
  const [cupones, setCupones] = useState<Cupon[]>([]);
  const [pagado, setPagado] = useState<Record<string, number>>({});
  const [informados, setInformados] = useState<PagoInformado[]>([]);
  const [noId, setNoId] = useState<CobroNoIdentificado[]>([]);
  // carga masiva
  const [cab, setCab] = useState({ fecha: hoyISO(), cuenta_id: '', metodo: 'efectivo', referencia: '' });
  const [sel, setSel] = useState<Record<string, string>>({});
  // no identificados
  const [nuevoNI, setNuevoNI] = useState(false);
  const [formNI, setFormNI] = useState({ fecha: hoyISO(), monto: '', metodo: 'transferencia', descripcion: '', cuenta_id: '' });
  const [identificar, setIdentificar] = useState<CobroNoIdentificado | null>(null);
  const [unidadNI, setUnidadNI] = useState('');
  const [rechazar, setRechazar] = useState<PagoInformado | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [u, c, l, inf, ni] = await Promise.all([
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true).order('uf'),
      supabase.from('cuentas').select('*').eq('consorcio_id', consorcio.id).order('nombre'),
      supabase.from('liquidaciones').select('*').eq('consorcio_id', consorcio.id).neq('estado', 'abierta').order('periodo', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('pagos_informados').select('*, unidades(*)').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('cobros_no_identificados').select('*, unidades(*)').eq('consorcio_id', consorcio.id).order('fecha', { ascending: false }).limit(200),
    ]);
    setUnidades((u.data as Unidad[]) || []); setCuentas((c.data as Cuenta[]) || []);
    setInformados((inf.data as PagoInformado[]) || []); setNoId((ni.data as CobroNoIdentificado[]) || []);
    const ultima = (l.data as Liquidacion) || null; setLiq(ultima);
    if (ultima) {
      const { data: cs } = await supabase.from('cupones').select('*').eq('liquidacion_id', ultima.id);
      const lista = (cs as Cupon[]) || []; setCupones(lista);
      const { data: pg } = lista.length ? await supabase.from('pagos').select('cupon_id, monto').in('cupon_id', lista.map((x) => x.id)) : { data: [] };
      const m: Record<string, number> = {};
      for (const p of (pg || []) as { cupon_id: string; monto: number }[]) m[p.cupon_id] = (m[p.cupon_id] || 0) + Number(p.monto);
      setPagado(m);
    } else { setCupones([]); setPagado({}); }
    setSel({}); setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const cuponDe = (unidadId: string) => cupones.find((c) => c.unidad_id === unidadId) || null;
  const saldoCupon = (c: Cupon) => round2(Math.max(0, montoEsperado(c, liq?.fecha_vencimiento_1 || null, liq?.fecha_vencimiento_2 || null).monto - (pagado[c.id] || 0)));
  const filas = useMemo(() => unidades.map((u) => { const c = cuponDe(u.id); return { u, c, saldo: c ? saldoCupon(c) : 0 }; }).filter((f) => f.c && f.saldo > 0), [unidades, cupones, pagado, liq]);
  const totalSel = round2(Object.values(sel).reduce((a, v) => a + num(v), 0));

  const run = async (f: () => Promise<string | void>) => { setBusy(true); setMsg(''); try { const r = await f(); if (r) setMsg(r); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } setBusy(false); };

  const guardarMasiva = () => run(async () => {
    const elegidas = Object.entries(sel).filter(([, v]) => num(v) > 0);
    if (!elegidas.length) return 'Tildá al menos una unidad.';
    for (const [unidadId, v] of elegidas) {
      await registrarPago({ consorcio_id: consorcio!.id, unidad_id: unidadId, cupon_id: cuponDe(unidadId)?.id || null, fecha: cab.fecha, monto: num(v), metodo: cab.metodo, comprobante: cab.referencia, cuenta_id: cab.cuenta_id || null, registrado_por: usuario });
    }
    return `${elegidas.length} cobranza${elegidas.length > 1 ? 's' : ''} registrada${elegidas.length > 1 ? 's' : ''} por ${fmtMoney(elegidas.reduce((a, [, v]) => a + num(v), 0))}.`;
  });

  const aprobar = (p: PagoInformado) => run(async () => {
    const pago = await registrarPago({ consorcio_id: p.consorcio_id, unidad_id: p.unidad_id, cupon_id: p.cupon_id || cuponDe(p.unidad_id)?.id || null, fecha: p.fecha, monto: Number(p.monto), metodo: METODOS.some((m) => m.value === p.metodo) ? p.metodo : 'transferencia', comprobante: p.referencia || undefined, observaciones: 'Informado por el propietario desde el portal', registrado_por: usuario });
    await supabase.from('pagos_informados').update({ estado: 'aprobado', pago_id: pago.id }).eq('id', p.id);
    return `Pago de ${ufTxt(p.unidades)} registrado.`;
  });
  const confirmarRechazo = () => run(async () => {
    if (!rechazar) return;
    await supabase.from('pagos_informados').update({ estado: 'rechazado', motivo: motivo.trim() || null }).eq('id', rechazar.id);
    setRechazar(null); setMotivo('');
  });

  const guardarNI = () => run(async () => {
    const monto = num(formNI.monto);
    if (monto <= 0) return 'Poné el monto exacto que figura en la cuenta.';
    const cuenta = formNI.cuenta_id || await cuentaPredeterminada(consorcio!.id);
    const { data, error } = await supabase.from('cobros_no_identificados').insert({ consorcio_id: consorcio!.id, cuenta_id: cuenta, fecha: formNI.fecha, monto, metodo: formNI.metodo, descripcion: formNI.descripcion.trim() || null }).select().single();
    if (error) throw new Error(error.message);
    // La plata ya entró: se registra el ingreso en la cuenta aunque no se sepa de quién es
    await supabase.from('movimientos').insert({ consorcio_id: consorcio!.id, cuenta_id: cuenta, fecha: formNI.fecha, tipo: 'ingreso', concepto: `Cobro no identificado${formNI.descripcion ? ` · ${formNI.descripcion}` : ''}`, monto, origen: 'no_identificado', origen_id: data.id });
    setNuevoNI(false); setFormNI({ fecha: hoyISO(), monto: '', metodo: 'transferencia', descripcion: '', cuenta_id: '' });
  });
  const confirmarIdentificar = () => run(async () => {
    const c = identificar; if (!c || !unidadNI) return 'Elegí la unidad.';
    const u = unidades.find((x) => x.id === unidadNI);
    const cupon = cuponDe(unidadNI);
    // Se crea el pago sin generar otro movimiento: el ingreso ya está, sólo cambia de nombre
    const { data: pago, error } = await supabase.from('pagos').insert({ consorcio_id: c.consorcio_id, unidad_id: unidadNI, cupon_id: cupon?.id || null, fecha: c.fecha, monto: c.monto, metodo: METODOS.some((m) => m.value === c.metodo) ? c.metodo : 'transferencia', observaciones: `Cobro identificado${c.descripcion ? ` · ${c.descripcion}` : ''}`, registrado_por: usuario }).select().single();
    if (error) throw new Error(error.message);
    if (cupon) await actualizarEstadoCupon(cupon.id);
    await supabase.from('movimientos').update({ origen: 'pago', origen_id: pago.id, concepto: `Cobranza expensas UF ${u?.uf ?? ''} ${u?.depto ?? ''}`.trim() }).eq('origen', 'no_identificado').eq('origen_id', c.id);
    await supabase.from('cobros_no_identificados').update({ estado: 'identificado', unidad_id: unidadNI, pago_id: pago.id }).eq('id', c.id);
    setIdentificar(null); setUnidadNI('');
    return `Cobro de ${fmtMoney(c.monto)} asignado a ${ufTxt(u)}.`;
  });
  const borrarNI = (c: CobroNoIdentificado) => run(async () => {
    await supabase.from('movimientos').delete().eq('origen', 'no_identificado').eq('origen_id', c.id);
    await supabase.from('cobros_no_identificados').delete().eq('id', c.id);
  });
  // Sugerencia: unidades cuyo saldo coincide con el monto del cobro
  const sugeridas = (monto: number) => filas.filter((f) => Math.abs(f.saldo - monto) < 1 || Math.abs(Number(f.c!.total) - monto) < 1 || Math.abs(Number(f.c!.total_2do_venc) - monto) < 1).map((f) => f.u.id);

  if (!consorcio) return null;
  const infPend = informados.filter((p) => p.estado === 'pendiente');
  const niPend = noId.filter((c) => c.estado === 'pendiente');
  const cuentaOpts = cuentas.map((c) => ({ value: c.id, label: c.nombre }));
  return (
    <div>
      <PageHeader title={`Cobranzas · ${consorcio.nombre}`} subtitle="Carga rápida de varios cobros, pagos que informan los propietarios y cobros sin identificar" />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'masiva', label: 'Carga masiva' }, { key: 'informados', label: 'Informados por propietarios', badge: infPend.length || undefined }, { key: 'noid', label: 'No identificados', badge: niPend.length || undefined }]} />
      {msg && <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 mb-4">{msg}</p>}
      {loading ? <Spinner /> : tab === 'masiva' ? (
        !liq ? <Card><EmptyState icon={<Check size={28} />} title="No hay expensas cerradas" subtitle="Cerrá una liquidación para poder registrar sus cobranzas." /></Card> : (
          <Card className="p-4">
            <p className="text-sm text-slate-500 mb-3">Expensa <b>{periodoLabel(liq.periodo)}</b>. Completá los datos comunes, tildá las unidades que pagaron y guardá. El monto se puede corregir.</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <Input label="Fecha" type="date" value={cab.fecha} onChange={(v) => setCab({ ...cab, fecha: v })} />
              <Select label="Cuenta de cobro" value={cab.cuenta_id} onChange={(v) => setCab({ ...cab, cuenta_id: v })} placeholder="Predeterminada" options={cuentaOpts} />
              <Select label="Forma de pago" value={cab.metodo} onChange={(v) => setCab({ ...cab, metodo: v })} options={METODOS} />
              <Input label="Referencia (opcional)" value={cab.referencia} onChange={(v) => setCab({ ...cab, referencia: v })} />
            </div>
            {filas.length === 0 ? <p className="text-sm text-slate-500">Todas las unidades tienen la expensa paga.</p> : (
              <Table headers={[<input key="t" type="checkbox" checked={filas.every((f) => sel[f.u.id] !== undefined)} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(filas.map((f) => [f.u.id, String(f.saldo)])) : {})} />, 'Unidad', 'Propietario', 'Saldo', 'Monto cobrado']}
                footer={<tr className="bg-slate-50 font-semibold"><Td colSpan={4}>{Object.keys(sel).length} seleccionada(s)</Td><Td className="text-right">{fmtMoney(totalSel)}</Td></tr>}>
                {filas.map(({ u, saldo }) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <Td><input type="checkbox" checked={sel[u.id] !== undefined} onChange={(e) => { const n = { ...sel }; if (e.target.checked) n[u.id] = String(saldo); else delete n[u.id]; setSel(n); }} /></Td>
                    <Td className="font-medium">{ufTxt(u)}</Td><Td className="text-slate-500">{u.propietario || '—'}</Td><Td className="text-right">{fmtMoney(saldo)}</Td>
                    <Td className="text-right">{sel[u.id] !== undefined && <input type="number" step="0.01" value={sel[u.id]} onChange={(e) => setSel({ ...sel, [u.id]: e.target.value })} className="w-32 px-2 py-1 rounded border border-slate-200 text-sm text-right" />}</Td>
                  </tr>
                ))}
              </Table>
            )}
            <div className="flex justify-end mt-4"><Button onClick={guardarMasiva} disabled={busy || !Object.keys(sel).length}>Registrar {Object.keys(sel).length || ''} cobranza(s)</Button></div>
          </Card>
        )
      ) : tab === 'informados' ? (
        informados.length === 0 ? <Card><EmptyState icon={<Check size={28} />} title="Nadie informó pagos todavía" subtitle="Los propietarios pueden avisar su pago desde el portal, con el comprobante. Acá los aprobás y quedan registrados." /></Card> : (
          <Card><Table headers={['Informado', 'Unidad', 'Fecha de pago', 'Monto', 'Forma', 'Referencia', 'Estado', '']}>
            {informados.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td>{fmtDate(p.created_at)}</Td><Td className="font-medium">{ufTxt(p.unidades)}</Td><Td>{fmtDate(p.fecha)}</Td><Td className="text-right">{fmtMoney(p.monto)}</Td><Td>{p.metodo}</Td>
                <Td className="text-slate-500">{p.referencia || '—'}{p.archivo_path && <a className="ml-2 text-teal-600 underline" target="_blank" rel="noreferrer" href={supabase.storage.from('archivos').getPublicUrl(p.archivo_path).data.publicUrl}>comprobante</a>}</Td>
                <Td><Badge color={p.estado === 'pendiente' ? 'amber' : p.estado === 'aprobado' ? 'green' : 'red'}>{p.estado.toUpperCase()}</Badge>{p.motivo && <span className="block text-xs text-slate-400">{p.motivo}</span>}</Td>
                <Td>{p.estado === 'pendiente' && <div className="flex gap-1"><Button size="sm" onClick={() => aprobar(p)} disabled={busy}><Check size={13} /> Aprobar</Button><Button size="sm" variant="secondary" onClick={() => { setMotivo(''); setRechazar(p); }}><X size={13} /> Rechazar</Button></div>}</Td>
              </tr>
            ))}
          </Table></Card>
        )
      ) : (
        <>
          <div className="flex justify-end mb-3"><Button onClick={() => setNuevoNI(true)}><Plus size={16} /> Nuevo cobro no identificado</Button></div>
          {noId.length === 0 ? <Card><EmptyState icon={<Link2 size={28} />} title="Sin cobros por identificar" subtitle="Cuando entra plata a la cuenta y no sabés de qué unidad es, cargala acá. El ingreso queda registrado y después lo asignás." /></Card> : (
            <Card><Table headers={['Fecha', 'Monto', 'Forma', 'Descripción', 'Estado', '']}>
              {noId.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>{fmtDate(c.fecha)}</Td><Td className="text-right font-medium">{fmtMoney(c.monto)}</Td><Td>{c.metodo}</Td><Td className="text-slate-500">{c.descripcion || '—'}</Td>
                  <Td>{c.estado === 'pendiente' ? <Badge color="amber">SIN IDENTIFICAR</Badge> : <Badge color="green">{ufTxt(c.unidades)}</Badge>}</Td>
                  <Td>{c.estado === 'pendiente' && <div className="flex gap-1"><Button size="sm" onClick={() => { setUnidadNI(sugeridas(Number(c.monto))[0] || ''); setIdentificar(c); }}><Link2 size={13} /> Identificar</Button><button onClick={() => borrarNI(c)} title="Eliminar" className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></div>}</Td>
                </tr>
              ))}
            </Table></Card>
          )}
        </>
      )}

      <Modal open={nuevoNI} onClose={() => setNuevoNI(false)} title="Cobro no identificado">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Monto (exacto, como figura en la cuenta)" type="number" step="0.01" required value={formNI.monto} onChange={(v) => setFormNI({ ...formNI, monto: v })} />
          <Input label="Fecha (la del banco)" type="date" value={formNI.fecha} onChange={(v) => setFormNI({ ...formNI, fecha: v })} />
          <Select label="Forma de pago" value={formNI.metodo} onChange={(v) => setFormNI({ ...formNI, metodo: v })} options={METODOS} />
          <Select label="Cuenta" value={formNI.cuenta_id} onChange={(v) => setFormNI({ ...formNI, cuenta_id: v })} placeholder="Predeterminada" options={cuentaOpts} />
          <div className="sm:col-span-2"><Input label="Descripción" value={formNI.descripcion} onChange={(v) => setFormNI({ ...formNI, descripcion: v })} placeholder="Lo que diga el extracto" /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setNuevoNI(false)}>Cancelar</Button><Button onClick={guardarNI} disabled={busy}>Guardar</Button></div>
      </Modal>
      <Modal open={!!identificar} onClose={() => setIdentificar(null)} title={`Identificar cobro de ${fmtMoney(identificar?.monto)}`}>
        {identificar && sugeridas(Number(identificar.monto)).length > 0 && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">Coincide con lo que debe: {sugeridas(Number(identificar.monto)).map((id) => ufTxt(unidades.find((u) => u.id === id))).join(', ')}.</p>}
        <Select label="¿De qué unidad es?" value={unidadNI} onChange={setUnidadNI} placeholder="— Elegir —" options={unidades.map((u) => { const f = filas.find((x) => x.u.id === u.id); return { value: u.id, label: `${ufTxt(u)} · ${u.propietario || ''}${f ? ` · debe ${fmtMoney(f.saldo)}` : ''}` }; })} />
        <p className="text-xs text-slate-500 mt-3">Se registra como cobranza de esa unidad con la fecha del cobro. Si paga de más queda a favor; si paga de menos, el saldo sigue como deuda.</p>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setIdentificar(null)}>Cancelar</Button><Button onClick={confirmarIdentificar} disabled={busy}>Asignar</Button></div>
      </Modal>
      <Modal open={!!rechazar} onClose={() => setRechazar(null)} title="Rechazar pago informado" size="sm">
        <Input label="Motivo (lo ve el propietario)" value={motivo} onChange={setMotivo} placeholder="Ej.: no figura en el extracto" />
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setRechazar(null)}>Cancelar</Button><Button variant="danger" onClick={confirmarRechazo}>Rechazar</Button></div>
      </Modal>
    </div>
  );
}

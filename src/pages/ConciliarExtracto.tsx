import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FileUp, Link2, MoreHorizontal, Wand2 } from 'lucide-react';
import { supabase, type Cuenta, type Movimiento, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { exportCSV, fmtDate, fmtMoney, hoyISO, registrarPago, round2, saldosPorUnidad } from '@/lib/engine';
import { identificar, parsearExtracto, patronDe, type LineaExtracto } from '@/lib/extracto';
import { ufTxt } from '@/lib/avisos';

type Linea = LineaExtracto & { id: string; estado: 'pendiente' | 'conciliado' | 'ignorado'; movimiento_ids: string[] };
type Agrupador = { id: string; patron: string; concepto: string };
type Accion = { tipo: 'movimiento' | 'gasto' | 'cobranza'; linea: Linea };
const firmado = (m: Movimiento) => (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto));

/** Conciliación bancaria con el extracto importado: dos columnas (banco y sistema), cruce automático y alta de lo que falta. */
export function ConciliarExtracto() {
  const { consorcio, usuario } = useApp();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuentaId, setCuentaId] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [agrup, setAgrup] = useState<Agrupador[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [importar, setImportar] = useState(false);
  const [texto, setTexto] = useState('');
  const [sugeridos, setSugeridos] = useState<Map<string, string>>(new Map());
  const [selL, setSelL] = useState<string[]>([]);
  const [selM, setSelM] = useState<string[]>([]);
  const [ocultar, setOcultar] = useState(true);
  const [menu, setMenu] = useState<string | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [fa, setFa] = useState({ concepto: '', recordar: true, unidad_id: '' });

  const load = async (cid = cuentaId) => {
    if (!consorcio) return;
    setLoading(true);
    const [c, u, a] = await Promise.all([
      supabase.from('cuentas').select('*').eq('consorcio_id', consorcio.id).eq('activa', true).order('nombre'),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true).order('uf'),
      supabase.from('extracto_agrupadores').select('*').order('patron'),
    ]);
    const cs = (c.data as Cuenta[]) || []; setCuentas(cs); setUnidades((u.data as Unidad[]) || []); setAgrup((a.data as Agrupador[]) || []);
    const id = cs.some((x) => x.id === cid) ? cid : cs.find((x) => x.tipo === 'banco')?.id || cs[0]?.id || '';
    setCuentaId(id);
    if (id) {
      const [l, m, s] = await Promise.all([
        supabase.from('extracto_lineas').select('*').eq('cuenta_id', id).order('fecha').limit(1000),
        supabase.from('movimientos').select('*').eq('cuenta_id', id).order('fecha').limit(2000),
        saldosPorUnidad(consorcio.id),
      ]);
      setLineas((l.data as Linea[]) || []); setMovs((m.data as Movimiento[]) || []);
      setSaldos(Object.fromEntries([...s.entries()].map(([k, v]) => [k, v.saldo])));
    } else { setLineas([]); setMovs([]); }
    setSelL([]); setSelM([]); setSugeridos(new Map()); setLoading(false);
  };
  useEffect(() => { load(''); }, [consorcio?.id]);

  const run = async (f: () => Promise<string | void>) => { setBusy(true); setMsg(''); try { const r = await f(); await load(); if (r) setMsg(r); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } setBusy(false); };
  const pendL = lineas.filter((l) => l.estado === 'pendiente');
  const pendM = movs.filter((m) => !m.conciliado);
  const desde = lineas.length ? lineas[0].fecha : '';
  const verL = ocultar ? pendL : lineas;
  const verM = (ocultar ? pendM : movs).filter((m) => !desde || m.fecha >= new Date(Date.parse(desde) - 10 * 86400000).toISOString().slice(0, 10));
  const sumaL = round2(lineas.filter((l) => selL.includes(l.id)).reduce((a, l) => a + l.monto, 0));
  const sumaM = round2(movs.filter((m) => selM.includes(m.id)).reduce((a, m) => a + firmado(m), 0));
  const conceptoDe = (l: Linea) => { const p = patronDe(l.descripcion); return agrup.find((a) => p.includes(a.patron))?.concepto || ''; };
  const sugerenciaUF = (monto: number) => unidades.filter((u) => Math.abs((saldos[u.id] || 0) - monto) < 1);
  const previa = useMemo(() => parsearExtracto(texto), [texto]);

  const marcar = async (ls: string[], ms: string[]) => {
    if (ms.length) await supabase.from('movimientos').update({ conciliado: true, fecha_conciliado: hoyISO() }).in('id', ms);
    for (const id of ls) await supabase.from('extracto_lineas').update({ estado: 'conciliado', movimiento_ids: ms }).eq('id', id);
  };
  const guardarImport = () => run(async () => {
    if (!previa.lineas.length) return 'No se encontraron movimientos en el texto. Tiene que tener fecha e importe en cada fila.';
    const { data: ya } = await supabase.from('extracto_lineas').select('fecha, descripcion, monto').eq('cuenta_id', cuentaId);
    const claves = new Set(((ya || []) as LineaExtracto[]).map((l) => `${l.fecha}|${l.descripcion}|${Number(l.monto)}`));
    const nuevas = previa.lineas.filter((l) => { const k = `${l.fecha}|${l.descripcion}|${l.monto}`; if (claves.has(k)) return false; claves.add(k); return true; });
    if (nuevas.length) { const { error } = await supabase.from('extracto_lineas').insert(nuevas.map((l) => ({ ...l, consorcio_id: consorcio!.id, cuenta_id: cuentaId }))); if (error) throw new Error(error.message); }
    setImportar(false); setTexto('');
    return `${nuevas.length} movimiento(s) del banco importado(s)${previa.lineas.length - nuevas.length ? `, ${previa.lineas.length - nuevas.length} ya estaban` : ''}. Tocá "Identificar" para cruzarlos.`;
  });
  const buscar = () => { const p = identificar(pendL, pendM); setSugeridos(p); setMsg(p.size ? `${p.size} coincidencia(s) por importe y fecha. Revisalas (en verde) y confirmá.` : 'No hay coincidencias exactas. Conciliá a mano o creá lo que falta desde los tres puntos.'); };
  const confirmarSugeridos = () => run(async () => { for (const [l, m] of sugeridos) await marcar([l], [m]); return `${sugeridos.size} movimiento(s) conciliado(s).`; });
  const conciliarSeleccion = () => run(async () => {
    if (!selL.length || !selM.length) return 'Elegí al menos un movimiento de cada lado.';
    if (Math.abs(sumaL - sumaM) > 0.01) return `No coinciden: banco ${fmtMoney(sumaL)} y sistema ${fmtMoney(sumaM)}.`;
    await marcar(selL, selM); return 'Conciliado.';
  });
  const desconciliar = (l: Linea) => run(async () => {
    if (l.movimiento_ids?.length) await supabase.from('movimientos').update({ conciliado: false, fecha_conciliado: null }).in('id', l.movimiento_ids);
    await supabase.from('extracto_lineas').update({ estado: 'pendiente', movimiento_ids: [] }).eq('id', l.id);
  });
  const ignorar = (l: Linea) => run(async () => { await supabase.from('extracto_lineas').update({ estado: 'ignorado' }).eq('id', l.id); });
  const noIdentificado = (l: Linea) => run(async () => {
    const { data, error } = await supabase.from('cobros_no_identificados').insert({ consorcio_id: consorcio!.id, cuenta_id: cuentaId, fecha: l.fecha, monto: l.monto, descripcion: l.descripcion || null }).select().single();
    if (error) throw new Error(error.message);
    const { data: m } = await supabase.from('movimientos').insert({ consorcio_id: consorcio!.id, cuenta_id: cuentaId, fecha: l.fecha, tipo: 'ingreso', concepto: `Cobro no identificado · ${l.descripcion}`.slice(0, 200), monto: l.monto, origen: 'no_identificado', origen_id: data.id, conciliado: true, fecha_conciliado: hoyISO() }).select().single();
    await supabase.from('extracto_lineas').update({ estado: 'conciliado', movimiento_ids: m ? [m.id] : [] }).eq('id', l.id);
    return 'Quedó en Cobranzas → No identificados para asignarlo cuando sepas de quién es.';
  });
  const abrir = (tipo: Accion['tipo'], l: Linea) => { setMenu(null); setFa({ concepto: conceptoDe(l) || l.descripcion, recordar: !conceptoDe(l), unidad_id: sugerenciaUF(l.monto)[0]?.id || '' }); setAccion({ tipo, linea: l }); };
  const confirmarAccion = () => run(async () => {
    const a = accion; if (!a) return; const l = a.linea; const abs = Math.abs(l.monto);
    let movId: string | null = null;
    if (a.tipo === 'cobranza') {
      if (!fa.unidad_id) return 'Elegí la unidad.';
      // Se imputa al último cupón impago de la unidad (si no hay, queda como pago a cuenta)
      const { data: cup } = await supabase.from('cupones').select('id, liquidaciones!inner(estado)').eq('unidad_id', fa.unidad_id).neq('estado', 'pagado').neq('liquidaciones.estado', 'abierta').order('created_at', { ascending: false }).limit(1).maybeSingle();
      const pago = await registrarPago({ consorcio_id: consorcio!.id, unidad_id: fa.unidad_id, cupon_id: cup?.id || null, fecha: l.fecha, monto: abs, metodo: 'transferencia', observaciones: l.descripcion, cuenta_id: cuentaId, registrado_por: usuario });
      const { data: m } = await supabase.from('movimientos').select('id').eq('origen', 'pago').eq('origen_id', pago.id).maybeSingle(); movId = m?.id || null;
    } else {
      const concepto = fa.concepto.trim(); if (!concepto) return 'Escribí el concepto.';
      let origen = 'manual'; let origen_id: string | null = null;
      if (a.tipo === 'gasto') {
        const { data: g, error } = await supabase.from('gastos').insert({ consorcio_id: consorcio!.id, liquidacion_id: null, descripcion: concepto, monto: abs, monto_a: abs, monto_b: 0, monto_c: 0, monto_d: 0, categoria: 'A', fecha: l.fecha, tipo_comprobante: 'Otro', pagado: true, fecha_pago: l.fecha, notas: `Creado desde el extracto: ${l.descripcion}` }).select().single();
        if (error) throw new Error(error.message); origen = 'gasto'; origen_id = g.id;
      }
      const { data: m, error } = await supabase.from('movimientos').insert({ consorcio_id: consorcio!.id, cuenta_id: cuentaId, fecha: l.fecha, tipo: l.monto > 0 ? 'ingreso' : 'egreso', concepto, monto: abs, origen, origen_id }).select().single();
      if (error) throw new Error(error.message); movId = m.id;
      const patron = patronDe(l.descripcion);
      if (fa.recordar && patron.length >= 4 && !agrup.some((x) => x.patron === patron)) await supabase.from('extracto_agrupadores').insert({ patron, concepto });
    }
    if (movId) await marcar([l.id], [movId]);
    setAccion(null);
    return a.tipo === 'gasto' ? 'Gasto creado y conciliado. Quedó en Gastos pendientes para sumarlo a una expensa.' : 'Creado y conciliado.';
  });
  const exportar = () => {
    exportCSV(`conciliacion_banco_${hoyISO()}.csv`, ['Fecha', 'Descripción', 'Importe', 'Estado'], lineas.map((l) => [l.fecha, l.descripcion, l.monto, l.estado]));
    exportCSV(`conciliacion_sistema_${hoyISO()}.csv`, ['Fecha', 'Concepto', 'Importe', 'Conciliado'], movs.map((m) => [m.fecha, m.concepto, firmado(m), m.conciliado ? 'sí' : 'no']));
  };

  if (!consorcio) return null;
  const tog = (arr: string[], set: (v: string[]) => void, id: string) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const monto = (n: number) => <span className={n < 0 ? 'text-red-600' : 'text-emerald-700'}>{fmtMoney(n)}</span>;
  const sugM = new Set(sugeridos.values());
  return (
    <div>
      <PageHeader title={`Conciliación con extracto · ${consorcio.nombre}`} subtitle="Importá el extracto del banco y cruzalo con lo cargado en el sistema"
        action={<div className="flex gap-2 flex-wrap">
          {lineas.length > 0 && <Button variant="secondary" onClick={exportar}><Download size={15} /> Exportar</Button>}
          <Button onClick={() => setImportar(true)} disabled={!cuentaId}><FileUp size={15} /> Importar extracto</Button>
        </div>} />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-64"><Select label="Cuenta" value={cuentaId} onChange={(v) => load(v)} options={cuentas.map((c) => ({ value: c.id, label: c.nombre }))} /></div>
        <Button variant="secondary" onClick={buscar} disabled={!pendL.length}><Wand2 size={15} /> Identificar</Button>
        {sugeridos.size > 0 && <Button onClick={confirmarSugeridos} disabled={busy}><Check size={15} /> Marcar {sugeridos.size} conciliados</Button>}
        {(selL.length > 0 || selM.length > 0) && <Button onClick={conciliarSeleccion} disabled={busy}><Link2 size={15} /> Conciliar selección ({fmtMoney(sumaL)} / {fmtMoney(sumaM)})</Button>}
        <label className="flex items-center gap-2 text-sm text-slate-600 ml-auto"><input type="checkbox" checked={ocultar} onChange={(e) => setOcultar(e.target.checked)} /> Ocultar conciliados</label>
      </div>
      {msg && <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 mb-4">{msg}</p>}
      {loading ? <Spinner /> : !cuentas.length ? <Card><EmptyState icon={<FileUp size={28} />} title="Primero creá la cuenta bancaria" subtitle="En Contabilidad → Cuentas." /></Card> : !lineas.length ? (
        <Card><EmptyState icon={<FileUp size={28} />} title="Todavía no importaste ningún extracto" subtitle="Bajalo del home banking en Excel o CSV y cargalo con Importar extracto." /></Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <p className="px-4 py-2.5 text-sm font-semibold text-slate-700 border-b border-slate-100">Banco <span className="font-normal text-slate-400">· {pendL.length} sin conciliar de {lineas.length}</span></p>
            <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
              {verL.map((l) => (
                <div key={l.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${sugeridos.has(l.id) ? 'bg-emerald-50' : l.estado !== 'pendiente' ? 'opacity-60' : ''}`}>
                  {l.estado === 'pendiente' ? <input type="checkbox" checked={selL.includes(l.id)} onChange={() => tog(selL, setSelL, l.id)} /> : <span className="w-[13px]" />}
                  <span className="w-20 shrink-0 text-slate-500">{fmtDate(l.fecha)}</span>
                  <span className="flex-1 min-w-0 truncate" title={l.descripcion}>{l.descripcion || '—'}{l.estado === 'pendiente' && conceptoDe(l) && <span className="ml-2 text-xs text-teal-600">→ {conceptoDe(l)}</span>}</span>
                  <span className="shrink-0 font-medium">{monto(l.monto)}</span>
                  {l.estado === 'pendiente' ? (
                    <div className="relative shrink-0">
                      <button title="Acciones" onClick={() => setMenu(menu === l.id ? null : l.id)} className="p-1 rounded hover:bg-slate-100 text-slate-500"><MoreHorizontal size={16} /></button>
                      {menu === l.id && <div className="absolute right-0 z-20 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm">
                        {l.monto > 0 && <button className="block w-full text-left px-3 py-1.5 hover:bg-slate-50" onClick={() => abrir('cobranza', l)}>Es una cobranza de expensas</button>}
                        {l.monto > 0 && <button className="block w-full text-left px-3 py-1.5 hover:bg-slate-50" onClick={() => { setMenu(null); noIdentificado(l); }}>Cobro no identificado</button>}
                        {l.monto < 0 && <button className="block w-full text-left px-3 py-1.5 hover:bg-slate-50" onClick={() => abrir('gasto', l)}>Crear gasto</button>}
                        <button className="block w-full text-left px-3 py-1.5 hover:bg-slate-50" onClick={() => abrir('movimiento', l)}>Crear movimiento</button>
                        <button className="block w-full text-left px-3 py-1.5 hover:bg-slate-50 text-slate-500" onClick={() => { setMenu(null); ignorar(l); }}>Ignorar esta línea</button>
                      </div>}
                    </div>
                  ) : <button onClick={() => desconciliar(l)} title="Volver a pendiente"><Badge color={l.estado === 'conciliado' ? 'green' : 'slate'}>{l.estado === 'conciliado' ? 'OK' : 'IGN'}</Badge></button>}
                </div>
              ))}
              {!verL.length && <p className="px-4 py-6 text-sm text-slate-400 text-center">Todo el extracto está conciliado.</p>}
            </div>
          </Card>
          <Card>
            <p className="px-4 py-2.5 text-sm font-semibold text-slate-700 border-b border-slate-100">Sistema <span className="font-normal text-slate-400">· {pendM.length} sin conciliar</span></p>
            <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
              {verM.map((m) => (
                <div key={m.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${sugM.has(m.id) ? 'bg-emerald-50' : m.conciliado ? 'opacity-60' : ''}`}>
                  {!m.conciliado ? <input type="checkbox" checked={selM.includes(m.id)} onChange={() => tog(selM, setSelM, m.id)} /> : <span className="w-[13px]" />}
                  <span className="w-20 shrink-0 text-slate-500">{fmtDate(m.fecha)}</span>
                  <span className="flex-1 min-w-0 truncate" title={m.concepto}>{m.concepto}</span>
                  <span className="shrink-0 font-medium">{monto(firmado(m))}</span>
                  {m.conciliado && <Badge color="green">OK</Badge>}
                </div>
              ))}
              {!verM.length && <p className="px-4 py-6 text-sm text-slate-400 text-center">No hay movimientos del sistema sin conciliar.</p>}
            </div>
          </Card>
        </div>
      )}

      <Modal open={importar} onClose={() => setImportar(false)} title="Importar extracto" size="lg">
        <p className="text-sm text-slate-500 mb-3">Elegí el archivo CSV que baja el banco, o abrí el Excel, copiá las filas y pegalas acá. Tiene que traer la fecha y el importe (una columna con signo, o débito y crédito).</p>
        <input type="file" accept=".csv,.txt,text/csv,text/plain" className="text-sm mb-3" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const buf = await f.arrayBuffer(); let t = new TextDecoder('utf-8').decode(buf); if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf); setTexto(t); }} />
        <Textarea label="O pegá el contenido" value={texto} onChange={setTexto} rows={6} placeholder={'Fecha;Descripción;Débito;Crédito\n03/11/2026;TRANSFERENCIA;;51.000,00'} />
        {texto.trim() && <p className={`text-sm mt-2 ${previa.lineas.length ? 'text-emerald-700' : 'text-red-600'}`}>{previa.lineas.length} movimiento(s) reconocido(s){previa.descartadas ? `, ${previa.descartadas} fila(s) sin fecha o importe (títulos, saldos)` : ''}{previa.lineas.length ? `: del ${fmtDate(previa.lineas.map((l) => l.fecha).sort()[0])} al ${fmtDate(previa.lineas.map((l) => l.fecha).sort().slice(-1)[0])}, entra ${fmtMoney(previa.lineas.filter((l) => l.monto > 0).reduce((a, l) => a + l.monto, 0))}, sale ${fmtMoney(-previa.lineas.filter((l) => l.monto < 0).reduce((a, l) => a + l.monto, 0))}` : ''}.</p>}
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setImportar(false)}>Cancelar</Button><Button onClick={guardarImport} disabled={busy || !previa.lineas.length}>Importar</Button></div>
      </Modal>

      <Modal open={!!accion} onClose={() => setAccion(null)} title={accion?.tipo === 'cobranza' ? 'Registrar cobranza' : accion?.tipo === 'gasto' ? 'Crear gasto desde el extracto' : 'Crear movimiento desde el extracto'}>
        {accion && <>
          <p className="text-sm text-slate-600 mb-3">{fmtDate(accion.linea.fecha)} · <b>{fmtMoney(accion.linea.monto)}</b> · {accion.linea.descripcion}</p>
          {accion.tipo === 'cobranza' ? <>
            {sugerenciaUF(accion.linea.monto).length > 0 && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">Coincide con lo que debe: {sugerenciaUF(accion.linea.monto).map((u) => ufTxt(u)).join(', ')}.</p>}
            <Select label="Unidad" value={fa.unidad_id} onChange={(v) => setFa({ ...fa, unidad_id: v })} placeholder="— Elegir —" options={unidades.map((u) => ({ value: u.id, label: `${ufTxt(u)} · ${u.propietario || ''}${saldos[u.id] > 0 ? ` · debe ${fmtMoney(saldos[u.id])}` : ''}` }))} />
          </> : <>
            <Input label="Concepto en el sistema" value={fa.concepto} onChange={(v) => setFa({ ...fa, concepto: v })} />
            <label className="flex items-center gap-2 text-sm text-slate-600 mt-3"><input type="checkbox" checked={fa.recordar} onChange={(e) => setFa({ ...fa, recordar: e.target.checked })} /> Recordar: cuando el banco diga "{patronDe(accion.linea.descripcion)}", proponer este concepto</label>
          </>}
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setAccion(null)}>Cancelar</Button><Button onClick={confirmarAccion} disabled={busy}>Crear y conciliar</Button></div>
        </>}
      </Modal>
    </div>
  );
}

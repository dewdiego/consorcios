import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AlertTriangle, CheckCircle2, FileSearch, Upload } from 'lucide-react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, type Rubro } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Input, Modal, Spinner, Table, Td, Tabs } from '@/components/ui';
import { extraerTextoPdf } from '@/lib/pdfText';
import { fmtMoney, fmtPct, notificar, periodoLabel, round2 } from '@/lib/engine';

/*
  Importar una liquidación de expensas desde el PDF de otro sistema (formato "Mis Expensas").
  Flujo: PDF → texto (en el navegador) → función importar-liquidacion (IA) → vista previa → alta en el sistema.
  Resultado: consorcio (nuevo o existente), unidades con coeficientes, gastos del período, liquidación CERRADA
  con el cupón de cada UF igual al del PDF (así la cuenta corriente arranca donde dejó el sistema anterior).
*/

type UnidadImp = {
  uf: number; depto: string; propietario: string;
  coef_a: number; coef_b: number; coef_c: number; coef_d: number;
  monto_a: number; monto_b: number; monto_c: number; monto_d: number;
  saldo_anterior: number; intereses: number; redondeo?: number; total: number;
  email?: string; telefono?: string;   // no vienen en el PDF: se completan a mano
};
type Cfg = { nombre: string; direccion: string; cuit: string; vencimiento_1: string; vencimiento_2: string; recargo: string; interes: string; honorarios: string };
type GastoImp = {
  rubro_pdf: string; rubro_sistema: string; proveedor?: string | null; cuit_proveedor?: string | null;
  descripcion: string; comprobante?: string | null; categoria: 'A' | 'B' | 'C' | 'D'; monto: number;
};
type EmpleadoImp = { nombre: string; cuil?: string | null; cargo: string; categoria?: string | null; sueldo_basico: number; neto: number; fecha_ingreso?: string | null; vive_en_edificio?: boolean };
export type Resultado = {
  administracion?: { nombre?: string; cuit?: string; email?: string; telefono?: string; rpa?: string };
  consorcio: { nombre: string; direccion?: string; cuit?: string; clave_suterh?: string };
  periodo: string; vencimiento_1: string | null; vencimiento_2: string | null; interes_mora_mensual_pct: number | null;
  columnas: { titulo_pdf: string; categoria: 'A' | 'B' | 'C' | 'D'; total: number }[];
  unidades: UnidadImp[]; gastos: GastoImp[]; empleados?: EmpleadoImp[];
  totales: { gastos: number; distribuido: number }; observaciones?: string[];
};

const CARGOS = ['encargado', 'ayudante', 'suplente', 'personal_limpieza', 'vigilancia', 'otro'];
const mapCargo = (c: string) => {
  const s = (c || '').toLowerCase();
  if (s.includes('enc')) return 'encargado';
  if (s.includes('ayud')) return 'ayudante';
  if (s.includes('supl')) return 'suplente';
  if (s.includes('limp')) return 'personal_limpieza';
  if (s.includes('vigil') || s.includes('segur')) return 'vigilancia';
  return CARGOS.includes(s) ? s : 'otro';
};

export function ImportarLiquidacion({ open, onClose, consorcioId, onImportado }: {
  open: boolean; onClose: () => void;
  consorcioId: string | null;                      // null = crear consorcio nuevo a partir del PDF
  onImportado: (consorcioId: string, liquidacionId: string) => void;
}) {
  const { usuario, reloadConsorcios } = useApp();
  const [paso, setPaso] = useState<'archivo' | 'analizando' | 'preview' | 'importando' | 'listo'>('archivo');
  const [progreso, setProgreso] = useState('');
  const [res, setRes] = useState<Resultado | null>(null);
  const [tab, setTab] = useState('unidades');
  const [error, setError] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [resumen, setResumen] = useState<string[]>([]);
  const [cfg, setCfg] = useState<Cfg>({ nombre: '', direccion: '', cuit: '', vencimiento_1: '', vencimiento_2: '', recargo: '0', interes: '0', honorarios: '' });
  const [confirmar, setConfirmar] = useState(false);

  const reset = () => { setPaso('archivo'); setRes(null); setError(''); setArchivo(null); setResumen([]); setTab('unidades'); setConfirmar(false); };
  const setU = (i: number, campo: keyof UnidadImp, valor: string) =>
    setRes((r) => r ? { ...r, unidades: r.unidades.map((u, j) => j === i ? { ...u, [campo]: ['depto', 'propietario', 'email', 'telefono'].includes(campo) ? valor : Number(valor.replace(',', '.')) || 0 } : u) } : r);
  const cerrar = () => { reset(); onClose(); };

  // ---------- 1. Analizar ----------
  const analizar = async () => {
    if (!archivo) return;
    setPaso('analizando'); setError('');
    try {
      setProgreso('Leyendo el PDF…');
      const texto = await extraerTextoPdf(archivo, (p, t) => setProgreso(`Leyendo página ${p} de ${t}…`));
      const { data: rubros } = await supabase.from('rubros').select('nombre').order('orden');
      setProgreso('Interpretando la liquidación (puede tardar hasta un minuto)…');
      // Llamada directa (la función responde en streaming para no superar el límite de 150 s de Supabase)
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/importar-liquidacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ texto, rubros: (rubros || []).map((r) => r.nombre) }),
      });
      const crudo = (await resp.text()).trim();
      let data: { resultado?: Resultado; error?: string } = {};
      try { data = JSON.parse(crudo.slice(crudo.lastIndexOf('\n') + 1) || crudo); } catch { data = { error: crudo.slice(0, 300) || `La función respondió ${resp.status}` }; }
      if (!resp.ok && !data.error) data.error = `La función respondió ${resp.status}. Revisá que exista en Supabase → Edge Functions con ese nombre exacto.`;
      if (data.error) throw new Error(`No se pudo ejecutar la función importar-liquidacion: ${data.error}`);
      const r = data.resultado as Resultado;
      if (!r?.unidades?.length) throw new Error('No se encontró la planilla de unidades en el PDF.');
      r.unidades.sort((a, b) => a.uf - b.uf);
      setRes(r);
      const honorarios = r.gastos.find((g) => /honorario/i.test(g.descripcion) || /administraci/i.test(g.rubro_sistema))?.monto;
      setCfg({
        nombre: r.consorcio?.nombre || '', direccion: r.consorcio?.direccion || '', cuit: r.consorcio?.cuit || '',
        vencimiento_1: r.vencimiento_1 || '', vencimiento_2: r.vencimiento_2 || '',
        recargo: '0', interes: String(r.interes_mora_mensual_pct || 0), honorarios: honorarios ? String(honorarios) : '',
      });
      setPaso('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPaso('archivo');
    }
  };

  // ---------- Controles de consistencia ----------
  const avisos: string[] = [];
  if (res) {
    const sum = (k: keyof UnidadImp) => round2(res.unidades.reduce((a, u) => a + Number(u[k] || 0), 0));
    for (const cat of ['a', 'b', 'c', 'd'] as const) {
      const s = sum(`coef_${cat}`);
      if (s > 0 && Math.abs(s - 100) > 0.5) avisos.push(`Los coeficientes de la columna ${cat.toUpperCase()} suman ${s.toFixed(2)}% (deberían ser 100%).`);
    }
    const totUF = sum('total');
    if (Math.abs(totUF - res.totales.distribuido) > 5) avisos.push(`La suma de los totales por UF (${fmtMoney(totUF)}) no coincide con el total de la planilla (${fmtMoney(res.totales.distribuido)}).`);
    const totG = round2(res.gastos.reduce((a, g) => a + Number(g.monto), 0));
    if (Math.abs(totG - res.totales.gastos) > 5) avisos.push(`La suma de los gastos leídos (${fmtMoney(totG)}) no coincide con el total de gastos del PDF (${fmtMoney(res.totales.gastos)}).`);
    for (const o of res.observaciones || []) avisos.push(o);
  }
  // Datos obligatorios que faltan: bloquean la importación hasta completarlos en pantalla
  const faltantes: string[] = [];
  if (res) {
    if (!consorcioId && !cfg.nombre.trim()) faltantes.push('Nombre del consorcio');
    if (!cfg.vencimiento_1) faltantes.push('Fecha del 1º vencimiento');
    const sinDepto = res.unidades.filter((u) => !u.depto?.trim()).map((u) => u.uf);
    if (sinDepto.length) faltantes.push(`Depto. en UF ${sinDepto.join(', ')}`);
    const sinProp = res.unidades.filter((u) => !u.propietario?.trim()).map((u) => u.uf);
    if (sinProp.length) faltantes.push(`Propietario en UF ${sinProp.join(', ')}`);
    const sinCoef = res.unidades.filter((u) => !(u.coef_a + u.coef_b + u.coef_c + u.coef_d > 0)).map((u) => u.uf);
    if (sinCoef.length) faltantes.push(`Coeficientes en UF ${sinCoef.join(', ')}`);
    const ufRep = res.unidades.map((u) => u.uf).filter((v, i, a) => a.indexOf(v) !== i);
    if (ufRep.length) faltantes.push(`Números de UF repetidos: ${[...new Set(ufRep)].join(', ')}`);
  }
  const sinMail = res ? res.unidades.filter((u) => !u.email?.trim()).length : 0;

  // ---------- 2. Importar ----------
  const importar = async () => {
    if (!res) return;
    setPaso('importando'); setError('');
    const log: string[] = [];
    try {
      const diaDe = (f: string | null, def: number) => (f ? Math.min(28, Number(f.slice(8, 10)) || def) : def);
      const v1 = cfg.vencimiento_1 || null, v2 = cfg.vencimiento_2 || null;
      const d1 = diaDe(v1, 10), d2 = v2 ? diaDe(v2, 20) : Math.min(28, d1 + 10);
      const config = {
        dia_vencimiento_1: d1, dia_vencimiento_2: d2 > d1 ? d2 : Math.min(28, d1 + 10),
        recargo_2do_venc_pct: Number(cfg.recargo) || 0, interes_mora_mensual_pct: Number(cfg.interes) || 0,
        honorarios_mensuales: Number(cfg.honorarios) || 0,
      };
      // Consorcio
      let cid = consorcioId;
      if (!cid) {
        const { data: c, error: cErr } = await supabase.from('consorcios').insert({
          nombre: cfg.nombre.trim(), direccion: cfg.direccion || null, cuit: cfg.cuit || null, ...config,
          notas: `Importado desde liquidación ${res.periodo}${res.administracion?.nombre ? ` (${res.administracion.nombre})` : ''}`,
        }).select().single();
        if (cErr) throw new Error(cErr.message);
        cid = c.id; log.push(`Consorcio creado: ${c.nombre}`);
      } else {
        await supabase.from('consorcios').update(config).eq('id', cid);
      }

      // La liquidación del período no debe existir
      const { data: ya } = await supabase.from('liquidaciones').select('id').eq('consorcio_id', cid).eq('periodo', res.periodo).maybeSingle();
      if (ya) throw new Error(`Ya existe la liquidación ${res.periodo} en este consorcio. Eliminala antes de importar.`);

      // Unidades (alta o actualización por número de UF)
      const { error: uErr } = await supabase.from('unidades').upsert(res.unidades.map((u) => ({
        consorcio_id: cid, uf: u.uf, depto: u.depto.trim(), propietario: u.propietario.trim(),
        propietario_email: u.email?.trim().toLowerCase() || null, propietario_telefono: u.telefono?.trim() || null,
        coef_a: u.coef_a || 0, coef_b: u.coef_b || 0, coef_c: u.coef_c || 0, coef_d: u.coef_d || 0, activo: true,
      })), { onConflict: 'consorcio_id,uf' });
      if (uErr) throw new Error(`Unidades: ${uErr.message}`);
      const { data: unidades } = await supabase.from('unidades').select('id, uf').eq('consorcio_id', cid);
      const ufId = new Map((unidades || []).map((u) => [u.uf, u.id]));
      log.push(`${res.unidades.length} unidades cargadas/actualizadas`);

      // Proveedores
      const nombres = [...new Set(res.gastos.map((g) => (g.proveedor || '').trim()).filter(Boolean))];
      const { data: provs } = await supabase.from('proveedores').select('id, nombre');
      const provId = new Map((provs || []).map((p) => [p.nombre.trim().toLowerCase(), p.id]));
      const nuevos = nombres.filter((n) => !provId.has(n.toLowerCase()));
      if (nuevos.length) {
        const { data: ins } = await supabase.from('proveedores').insert(nuevos.map((n) => ({
          nombre: n, cuit: res.gastos.find((g) => (g.proveedor || '').trim() === n)?.cuit_proveedor || null,
        }))).select('id, nombre');
        for (const p of ins || []) provId.set(p.nombre.trim().toLowerCase(), p.id);
        log.push(`${nuevos.length} proveedores nuevos`);
      }

      // Rubros
      const { data: rubros } = await supabase.from('rubros').select('*');
      const rubroId = (nombre: string) => {
        const lista = (rubros as Rubro[]) || [];
        const exact = lista.find((r) => r.nombre.toLowerCase() === (nombre || '').toLowerCase());
        return exact?.id || lista.find((r) => r.nombre === 'Otros')?.id || null;
      };

      // Liquidación cerrada
      const [y, m] = res.periodo.split('-').map(Number);
      const ultimoDia = new Date(y, m, 0).toISOString().slice(0, 10);
      const totalGastos = round2(res.gastos.reduce((a, g) => a + Number(g.monto), 0));
      const totalDistribuido = round2(res.unidades.reduce((a, u) => a + Number(u.total), 0));
      const { data: liq, error: lErr } = await supabase.from('liquidaciones').insert({
        consorcio_id: cid, periodo: res.periodo, estado: 'cerrada',
        fecha_vencimiento_1: v1, fecha_vencimiento_2: v2 || v1,
        recargo_2do_venc_pct: config.recargo_2do_venc_pct, interes_mora_pct: config.interes_mora_mensual_pct,
        total_gastos: totalGastos, total_distribuido: totalDistribuido,
        cerrada_por: `${usuario} (importación PDF)`, cerrada_at: new Date().toISOString(),
        notas: `Importada desde PDF${res.administracion?.nombre ? ` de ${res.administracion.nombre}` : ''}. Columnas: ${res.columnas.map((c) => `${c.categoria}=${c.titulo_pdf}`).join(', ')}.`,
      }).select().single();
      if (lErr) throw new Error(`Liquidación: ${lErr.message}`);

      // Gastos
      const { error: gErr } = await supabase.from('gastos').insert(res.gastos.map((g) => ({
        consorcio_id: cid, liquidacion_id: liq.id, proveedor_id: provId.get((g.proveedor || '').trim().toLowerCase()) || null,
        rubro_id: rubroId(g.rubro_sistema), descripcion: `${g.descripcion}`.slice(0, 500),
        categoria: g.categoria, monto: round2(g.monto),
        monto_a: g.categoria === 'A' ? round2(g.monto) : 0, monto_b: g.categoria === 'B' ? round2(g.monto) : 0,
        monto_c: g.categoria === 'C' ? round2(g.monto) : 0, monto_d: g.categoria === 'D' ? round2(g.monto) : 0,
        fecha: ultimoDia, comprobante: g.comprobante || null, pagado: true, fecha_pago: ultimoDia, periodo_facturado: res.periodo,
      })));
      if (gErr) throw new Error(`Gastos: ${gErr.message}`);
      log.push(`${res.gastos.length} gastos por ${fmtMoney(totalGastos)}`);

      // Cupones tal cual el PDF
      const { error: cuErr } = await supabase.from('cupones').insert(res.unidades.map((u) => ({
        liquidacion_id: liq.id, consorcio_id: cid, unidad_id: ufId.get(u.uf),
        monto_a: round2(u.monto_a), monto_b: round2(u.monto_b), monto_c: round2(u.monto_c), monto_d: round2(u.monto_d + (u.redondeo || 0)),
        saldo_anterior: round2(u.saldo_anterior), intereses: round2(u.intereses),
        total: round2(u.total), total_2do_venc: round2(u.total), estado: 'pendiente',
      })));
      if (cuErr) throw new Error(`Cupones: ${cuErr.message}`);
      log.push(`${res.unidades.length} cupones por ${fmtMoney(totalDistribuido)}`);

      // Empleados
      if (res.empleados?.length) {
        const { data: emps } = await supabase.from('empleados').select('nombre').eq('consorcio_id', cid);
        const existentes = new Set((emps || []).map((e) => e.nombre.toLowerCase()));
        const altas = res.empleados.filter((e) => !existentes.has(e.nombre.toLowerCase()));
        if (altas.length) {
          await supabase.from('empleados').insert(altas.map((e) => ({
            consorcio_id: cid, nombre: e.nombre, cuil: e.cuil || null, cargo: mapCargo(e.cargo), categoria: e.categoria || null,
            sueldo_basico: round2(e.sueldo_basico), antiguedad_fecha: e.fecha_ingreso || null, vive_en_edificio: !!e.vive_en_edificio,
          })));
          log.push(`${altas.length} empleados`);
        }
      }

      await notificar('info', `Liquidación ${res.periodo} importada`, `${cfg.nombre || res.consorcio.nombre}: ${log.join(' · ')}`);
      await reloadConsorcios();
      setResumen(log);
      setPaso('listo');
      onImportado(cid!, liq.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPaso('preview');
    }
  };

  const catColor = (c: string) => (c === 'A' ? 'teal' : c === 'B' ? 'blue' : c === 'C' ? 'purple' : 'orange') as 'teal' | 'blue' | 'purple' | 'orange';

  return (
    <Modal open={open} onClose={cerrar} title="Importar liquidación desde PDF" size="lg">
      {paso === 'archivo' && (
        <div>
          <p className="text-sm text-slate-600 mb-4">
            Subí la última liquidación de expensas del edificio (formato "Mis Expensas", de cualquier sistema).
            El sistema lee las unidades con sus coeficientes y saldos, los gastos del período y los empleados, y
            {consorcioId ? ' los carga en este consorcio.' : ' crea el consorcio con todo cargado.'}
          </p>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl p-8 cursor-pointer hover:border-teal-400 hover:bg-teal-50/30">
            <Upload size={26} className="text-slate-400" />
            <span className="text-sm text-slate-600">{archivo ? archivo.name : 'Elegir PDF de la liquidación'}</span>
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
          </label>
          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="secondary" onClick={cerrar}>Cancelar</Button>
            <Button onClick={analizar} disabled={!archivo}><FileSearch size={15} /> Analizar</Button>
          </div>
        </div>
      )}

      {paso === 'analizando' && (
        <div className="py-6 text-center">
          <Spinner />
          <p className="text-sm text-slate-600 -mt-8">{progreso}</p>
        </div>
      )}

      {(paso === 'preview' || paso === 'importando') && res && (
        <div>
          <div className="bg-slate-50 rounded-lg p-4 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Revisá y completá los datos del edificio</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2"><Input label="Nombre del consorcio" value={cfg.nombre} onChange={(v) => setCfg({ ...cfg, nombre: v })} required /></div>
              <div className="col-span-2"><Input label="Dirección" value={cfg.direccion} onChange={(v) => setCfg({ ...cfg, direccion: v })} /></div>
              <Input label="CUIT" value={cfg.cuit} onChange={(v) => setCfg({ ...cfg, cuit: v })} />
              <Input label="1º vencimiento" type="date" value={cfg.vencimiento_1} onChange={(v) => setCfg({ ...cfg, vencimiento_1: v })} required />
              <Input label="2º vencimiento" type="date" value={cfg.vencimiento_2} onChange={(v) => setCfg({ ...cfg, vencimiento_2: v })} />
              <Input label="Recargo 2º venc. (%)" type="number" step="0.01" value={cfg.recargo} onChange={(v) => setCfg({ ...cfg, recargo: v })} />
              <Input label="Interés mora mensual (%)" type="number" step="0.01" value={cfg.interes} onChange={(v) => setCfg({ ...cfg, interes: v })} />
              <Input label="Honorarios adm. ($/mes)" type="number" step="0.01" value={cfg.honorarios} onChange={(v) => setCfg({ ...cfg, honorarios: v })} />
              <div className="col-span-2 text-sm pt-1">
                <p><span className="text-slate-400 text-xs">Período</span> <b>{periodoLabel(res.periodo)}</b> · <span className="text-slate-400 text-xs">Gastos</span> <b>{fmtMoney(res.totales.gastos)}</b> · <span className="text-slate-400 text-xs">A cobrar</span> <b>{fmtMoney(res.totales.distribuido)}</b></p>
                <div className="flex flex-wrap gap-1 mt-1">{res.columnas.map((c, i) => <Badge key={i} color={catColor(c.categoria)}>{c.categoria} = {c.titulo_pdf}</Badge>)}</div>
              </div>
            </div>
          </div>

          {faltantes.length > 0 && (
            <div className="bg-red-50 text-red-700 text-xs rounded-lg px-4 py-3 mb-4">
              <p className="font-semibold mb-1">Falta completar antes de importar:</p>
              <ul className="list-disc pl-4 space-y-0.5">{faltantes.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}

          {avisos.length > 0 && (
            <div className="bg-amber-50 text-amber-800 text-xs rounded-lg px-4 py-3 mb-4 space-y-1">
              {avisos.map((a, i) => <p key={i} className="flex gap-2"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{a}</p>)}
              <p className="text-amber-600 pt-1">Revisá los datos antes de importar. Después podés corregir cualquier unidad o gasto desde el sistema.</p>
            </div>
          )}

          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'unidades', label: 'Unidades', badge: res.unidades.length },
            { key: 'gastos', label: 'Gastos', badge: res.gastos.length },
            { key: 'empleados', label: 'Empleados', badge: res.empleados?.length || 0 },
          ]} />

          <div className="max-h-[45vh] overflow-y-auto border border-slate-100 rounded-lg">
            {tab === 'unidades' ? (
              <>
                <p className="text-[11px] text-slate-400 px-3 pt-2">Podés corregir cualquier celda. El mail y el teléfono no vienen en el PDF: cargalos ahora o después desde Unidades ({sinMail} sin mail).</p>
                <Table headers={['UF', 'Depto', 'Propietario', 'Mail', 'Teléfono', '% A', '% B', '% C', '% D', 'Saldo ant.', 'Int.', 'Total']}>
                  {res.unidades.map((u, i) => {
                    const cell = (campo: keyof UnidadImp, w: string, type = 'text', falta = false) => (
                      <input type={type} step="0.0001" value={String(u[campo] ?? '')} onChange={(e) => setU(i, campo, e.target.value)}
                        className={`${w} px-1.5 py-1 text-xs border rounded ${falta ? 'border-red-300 bg-red-50' : 'border-slate-200'} focus:outline-none focus:border-teal-500`} />
                    );
                    return (
                      <tr key={i}>
                        <Td className="font-mono text-xs">{String(u.uf).padStart(3, '0')}</Td>
                        <Td>{cell('depto', 'w-16', 'text', !u.depto?.trim())}</Td>
                        <Td>{cell('propietario', 'w-40', 'text', !u.propietario?.trim())}</Td>
                        <Td>{cell('email', 'w-44', 'email')}</Td>
                        <Td>{cell('telefono', 'w-28')}</Td>
                        <Td>{cell('coef_a', 'w-16', 'number')}</Td>
                        <Td>{cell('coef_b', 'w-16', 'number')}</Td>
                        <Td>{cell('coef_c', 'w-16', 'number')}</Td>
                        <Td>{cell('coef_d', 'w-16', 'number')}</Td>
                        <Td className={`text-xs whitespace-nowrap ${u.saldo_anterior > 0 ? 'text-red-500' : u.saldo_anterior < 0 ? 'text-emerald-600' : ''}`}>{u.saldo_anterior ? fmtMoney(u.saldo_anterior) : ''}</Td>
                        <Td className="text-xs whitespace-nowrap">{u.intereses ? fmtMoney(u.intereses) : ''}</Td>
                        <Td className="font-semibold whitespace-nowrap">{fmtMoney(u.total)}</Td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-50 font-semibold text-xs">
                    <Td colSpan={5} className="text-right">Suma de coeficientes</Td>
                    {(['coef_a', 'coef_b', 'coef_c', 'coef_d'] as const).map((k) => {
                      const sum = round2(res.unidades.reduce((a, u) => a + Number(u[k] || 0), 0));
                      return <Td key={k} className={sum === 0 ? 'text-slate-300' : Math.abs(sum - 100) <= 0.5 ? 'text-emerald-600' : 'text-red-500'}>{fmtPct(sum)}</Td>;
                    })}
                    <Td colSpan={3} />
                  </tr>
                </Table>
              </>
            ) : tab === 'gastos' ? (
              <Table headers={['Rubro', 'Proveedor', 'Descripción', 'Cat.', 'Monto']}>
                {res.gastos.map((g, i) => (
                  <tr key={i}>
                    <Td className="text-xs text-slate-500">{g.rubro_sistema}</Td>
                    <Td className="text-xs">{g.proveedor || '—'}</Td>
                    <Td className="max-w-[260px]"><span className="block truncate" title={g.descripcion}>{g.descripcion}</span></Td>
                    <Td><Badge color={catColor(g.categoria)}>{g.categoria}</Badge></Td>
                    <Td className="font-semibold">{fmtMoney(g.monto)}</Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Table headers={['Nombre', 'CUIL', 'Cargo', 'Categoría', 'Básico', 'Neto']}>
                {(res.empleados || []).map((e, i) => (
                  <tr key={i}>
                    <Td className="font-medium">{e.nombre}</Td>
                    <Td className="font-mono text-xs">{e.cuil || '—'}</Td>
                    <Td className="text-xs">{e.cargo}</Td>
                    <Td className="text-xs">{e.categoria || '—'}</Td>
                    <Td>{fmtMoney(e.sueldo_basico)}</Td>
                    <Td className="font-semibold">{fmtMoney(e.neto)}</Td>
                  </tr>
                ))}
                {!res.empleados?.length && <tr><Td colSpan={6} className="text-center text-slate-400 py-6">Sin empleados en el PDF</Td></tr>}
              </Table>
            )}
          </div>

          {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
          <div className="flex justify-between items-center gap-2 mt-5">
            <Button variant="ghost" onClick={reset} disabled={paso === 'importando'}>Elegir otro PDF</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={cerrar} disabled={paso === 'importando'}>Cancelar</Button>
              <Button onClick={() => setConfirmar(true)} disabled={paso === 'importando' || faltantes.length > 0} className={faltantes.length ? 'opacity-50' : ''}>
                {paso === 'importando' ? 'Importando…' : faltantes.length ? `Faltan ${faltantes.length} datos` : 'Continuar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={confirmar} onCancel={() => setConfirmar(false)} peligro={false} confirmLabel="Sí, dar de alta"
        onConfirm={() => { setConfirmar(false); importar(); }}
        title={consorcioId ? 'Confirmar importación' : 'Confirmar alta del edificio'}
        message={res ? [
          consorcioId ? `Se importa la liquidación ${periodoLabel(res.periodo)} en este consorcio.` : `Se crea el consorcio "${cfg.nombre}" con vencimientos los días ${cfg.vencimiento_1 ? Number(cfg.vencimiento_1.slice(8, 10)) : '-'}${cfg.vencimiento_2 ? ` y ${Number(cfg.vencimiento_2.slice(8, 10))}` : ''}.`,
          `Altas: ${res.unidades.length} unidades con sus propietarios y coeficientes${sinMail ? ` (${sinMail} sin mail)` : ''}, ${res.gastos.length} gastos por ${fmtMoney(res.gastos.reduce((a, g) => a + Number(g.monto), 0))}, ${res.empleados?.length || 0} empleados, y la liquidación ${periodoLabel(res.periodo)} cerrada con ${res.unidades.length} cupones por ${fmtMoney(res.unidades.reduce((a, u) => a + Number(u.total), 0))}.`,
          '¿Confirmás?',
        ].join(' ') : ''} />

      {paso === 'listo' && (
        <div className="py-4 text-center">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-3" />
          <p className="font-semibold text-slate-800 mb-2">Liquidación importada</p>
          <ul className="text-sm text-slate-600 space-y-0.5">{resumen.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="text-xs text-slate-400 mt-4">La liquidación quedó cerrada con los cupones del PDF. Cargá los mails de los propietarios en Unidades y ya podés cobrar y liquidar el mes siguiente desde el sistema.</p>
          <Button className="mt-5" onClick={cerrar}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}

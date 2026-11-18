import { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { supabase, type Administracion, type Consorcio, type Cuenta, type Movimiento, type Unidad } from '@/lib/supabase';
import { Button, Card, Input, Spinner, Table, Td } from '@/components/ui';
import { exportCSV, fmtDate, fmtMoney, round2 } from '@/lib/engine';
import { escHtml, imprimirHtml } from '@/lib/imprimir';

/*
  Rendición anual de cuentas (para la asamblea y para el contador / DDJJ RPA):
  - Mes a mes: gastos liquidados, expensas emitidas, cobrado, pagado a proveedores, sueldos.
  - Gastos del año por rubro.
  - Caja y bancos: saldo al 1/1, ingresos, egresos, saldo al 31/12 por cuenta.
  - Deudores al cierre del año (cupones emitidos hasta diciembre − pagos hasta el 31/12).
  - Retenciones practicadas y sueldos.
  Todo sale de las liquidaciones cerradas, pagos, gastos, movimientos y sueldos ya cargados.
*/

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
type Mes = { mes: string; gastos: number; emitido: number; cobrado: number; pagado: number; sueldos: number };
type Rubro = { rubro: string; monto: number; cant: number };
type CuentaRes = { nombre: string; inicial: number; ing: number; egr: number; final: number };
type Deudor = { uf: number; depto: string; propietario: string; saldo: number };

export function RendicionAnual({ consorcio }: { consorcio: Consorcio }) {
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(true);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [cuentasRes, setCuentasRes] = useState<CuentaRes[]>([]);
  const [deudores, setDeudores] = useState<Deudor[]>([]);
  const [aFavor, setAFavor] = useState(0);
  const [retenciones, setRetenciones] = useState<{ tipo: string; monto: number }[]>([]);
  const [admin, setAdmin] = useState<Administracion | null>(null);
  const [gastosDetalle, setGastosDetalle] = useState<Record<string, unknown>[]>([]);
  // Para la rendición impresa: egresos por rubro y mes, otros ingresos y caja mes a mes (todas las cuentas juntas)
  const [egresosMes, setEgresosMes] = useState<{ rubro: string; vals: number[] }[]>([]);
  const [otrosIng, setOtrosIng] = useState<number[]>(Array(12).fill(0));
  const [cajaMes, setCajaMes] = useState<{ ing: number[]; egr: number[] }>({ ing: Array(12).fill(0), egr: Array(12).fill(0) });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const d1 = `${anio}-01-01`, d2 = `${anio}-12-31`, p1 = `${anio}-01`, p2 = `${anio}-12`;
      const [liq, gas, pag, mov, cue, sue, ret, cup, pagTodos, uni, adm] = await Promise.all([
        supabase.from('liquidaciones').select('id, periodo, total_gastos, total_distribuido').eq('consorcio_id', consorcio.id).neq('estado', 'abierta').gte('periodo', p1).lte('periodo', p2),
        supabase.from('gastos').select('fecha, monto, descripcion, categoria, comprobante, tipo_comprobante, pagado, fecha_pago, rubros(nombre), proveedores(nombre, cuit), liquidaciones(periodo)').eq('consorcio_id', consorcio.id).gte('fecha', d1).lte('fecha', d2).order('fecha'),
        supabase.from('pagos').select('fecha, monto').eq('consorcio_id', consorcio.id).gte('fecha', d1).lte('fecha', d2),
        supabase.from('movimientos').select('*').eq('consorcio_id', consorcio.id).lte('fecha', d2),
        supabase.from('cuentas').select('*').eq('consorcio_id', consorcio.id),
        supabase.from('sueldo_liquidaciones').select('periodo, costo_total, neto').eq('consorcio_id', consorcio.id).gte('periodo', p1).lte('periodo', p2),
        supabase.from('retenciones').select('tipo, monto').eq('consorcio_id', consorcio.id).gte('fecha', d1).lte('fecha', d2),
        supabase.from('cupones').select('unidad_id, total, saldo_anterior, liquidaciones!inner(periodo, estado)').eq('consorcio_id', consorcio.id),
        supabase.from('pagos').select('unidad_id, monto').eq('consorcio_id', consorcio.id).lte('fecha', d2),
        supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).order('uf'),
        supabase.from('administracion').select('*').limit(1).maybeSingle(),
      ]);
      setAdmin(adm.data as Administracion | null);

      // Mes a mes
      const ms: Mes[] = MESES.map((m) => ({ mes: m, gastos: 0, emitido: 0, cobrado: 0, pagado: 0, sueldos: 0 }));
      const idx = (f: string) => Number(f.slice(5, 7)) - 1;
      for (const l of (liq.data || []) as { periodo: string; total_gastos: number; total_distribuido: number }[]) { ms[idx(l.periodo)].gastos += Number(l.total_gastos); ms[idx(l.periodo)].emitido += Number(l.total_distribuido); }
      for (const p of (pag.data || []) as { fecha: string; monto: number }[]) ms[idx(p.fecha)].cobrado += Number(p.monto);
      for (const m of (mov.data || []) as Movimiento[]) if (m.fecha >= d1 && m.tipo === 'egreso' && m.origen === 'orden_pago') ms[idx(m.fecha)].pagado += Number(m.monto);
      for (const s of (sue.data || []) as { periodo: string; costo_total: number }[]) ms[idx(s.periodo)].sueldos += Number(s.costo_total);
      setMeses(ms.map((m) => ({ ...m, gastos: round2(m.gastos), emitido: round2(m.emitido), cobrado: round2(m.cobrado), pagado: round2(m.pagado), sueldos: round2(m.sueldos) })));

      // Rubros (gastos liquidados en el año)
      const rb: Record<string, Rubro> = {};
      type G = { fecha: string; monto: number; descripcion: string; categoria: string; comprobante: string | null; tipo_comprobante: string; pagado: boolean; fecha_pago: string | null; rubros: { nombre: string } | null; proveedores: { nombre: string; cuit: string | null } | null; liquidaciones: { periodo: string } | null };
      const gl = (gas.data || []) as unknown as G[];
      for (const g of gl) { const k = g.rubros?.nombre || 'Sin rubro'; (rb[k] ||= { rubro: k, monto: 0, cant: 0 }); rb[k].monto = round2(rb[k].monto + Number(g.monto)); rb[k].cant++; }
      setRubros(Object.values(rb).sort((a, b) => b.monto - a.monto));
      const em: Record<string, number[]> = {};
      for (const g of gl) { const k = g.rubros?.nombre || 'Sin rubro'; (em[k] ||= Array(12).fill(0))[idx(g.fecha)] += Number(g.monto); }
      setEgresosMes(Object.entries(em).map(([rubro, vals]) => ({ rubro, vals: vals.map(round2) })).sort((a, b) => b.vals.reduce((x, y) => x + y, 0) - a.vals.reduce((x, y) => x + y, 0)));
      setGastosDetalle(gl.map((g) => ({ fecha: g.fecha, periodo: g.liquidaciones?.periodo || '', rubro: g.rubros?.nombre || '', proveedor: g.proveedores?.nombre || '', cuit: g.proveedores?.cuit || '', descripcion: g.descripcion, categoria: g.categoria, tipo_comprobante: g.tipo_comprobante, comprobante: g.comprobante || '', monto: Number(g.monto), pagado: g.pagado ? 'sí' : 'no', fecha_pago: g.fecha_pago || '' })));

      // Cuentas
      const movs = (mov.data || []) as Movimiento[];
      const signo = (m: Movimiento) => (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto));
      setCuentasRes(((cue.data || []) as Cuenta[]).map((c) => {
        const propios = movs.filter((m) => m.cuenta_id === c.id && m.fecha >= c.fecha_saldo_inicial);
        const inicial = round2((d1 > c.fecha_saldo_inicial ? Number(c.saldo_inicial) : 0) + propios.filter((m) => m.fecha < d1).reduce((a, m) => a + signo(m), 0));
        const del = propios.filter((m) => m.fecha >= d1);
        const ing = round2(del.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0));
        const egr = round2(del.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0));
        const ajusteInicial = d1 <= c.fecha_saldo_inicial && c.fecha_saldo_inicial <= d2 ? Number(c.saldo_inicial) : 0; // cuenta abierta durante el año
        return { nombre: c.nombre, inicial, ing: round2(ing + ajusteInicial), egr, final: round2(inicial + ing + ajusteInicial - egr) };
      }));

      // Otros ingresos (cargados a mano en caja) y caja mes a mes; las transferencias entre cuentas propias no cuentan
      const cuentasPorId = new Map(((cue.data || []) as Cuenta[]).map((c) => [c.id, c]));
      const oi = Array(12).fill(0), ci = Array(12).fill(0), ce = Array(12).fill(0);
      for (const m of movs) {
        const c = cuentasPorId.get(m.cuenta_id || ''); if (!c || m.fecha < d1 || m.fecha < c.fecha_saldo_inicial || m.origen === 'transferencia') continue;
        if (m.tipo === 'ingreso') { ci[idx(m.fecha)] += Number(m.monto); if (m.origen === 'manual') oi[idx(m.fecha)] += Number(m.monto); } else ce[idx(m.fecha)] += Number(m.monto);
      }
      for (const c of cuentasPorId.values()) if (d1 <= c.fecha_saldo_inicial && c.fecha_saldo_inicial <= d2) ci[idx(c.fecha_saldo_inicial)] += Number(c.saldo_inicial); // cuenta abierta durante el año
      setOtrosIng(oi.map(round2)); setCajaMes({ ing: ci.map(round2), egr: ce.map(round2) });

      // Deudores al 31/12
      const deuda: Record<string, number> = {};
      // Cada cupón ya incluye el saldo anterior: del primero de cada unidad se toma el total y de los siguientes sólo lo nuevo
      const cerrados = ((cup.data || []) as unknown as { unidad_id: string; total: number; saldo_anterior: number; liquidaciones: { periodo: string; estado: string } }[])
        .filter((c) => c.liquidaciones.estado !== 'abierta' && c.liquidaciones.periodo <= p2).sort((x, y) => x.liquidaciones.periodo.localeCompare(y.liquidaciones.periodo));
      const conPrimero = new Set<string>();
      for (const c of cerrados) { const primero = !conPrimero.has(c.unidad_id); conPrimero.add(c.unidad_id); deuda[c.unidad_id] = (deuda[c.unidad_id] || 0) + (primero ? Number(c.total) : Number(c.total) - Number(c.saldo_anterior)); }
      for (const p of (pagTodos.data || []) as { unidad_id: string; monto: number }[]) deuda[p.unidad_id] = (deuda[p.unidad_id] || 0) - Number(p.monto);
      const us = (uni.data || []) as Unidad[];
      const ds = us.map((u) => ({ uf: u.uf, depto: u.depto, propietario: u.propietario || '', saldo: round2(deuda[u.id] || 0) }));
      setDeudores(ds.filter((d) => d.saldo > 1).sort((a, b) => b.saldo - a.saldo));
      setAFavor(round2(ds.filter((d) => d.saldo < -1).reduce((a, d) => a - d.saldo, 0)));

      const rt: Record<string, number> = {};
      for (const r of (ret.data || []) as { tipo: string; monto: number }[]) rt[r.tipo] = round2((rt[r.tipo] || 0) + Number(r.monto));
      setRetenciones(Object.entries(rt).map(([tipo, monto]) => ({ tipo, monto })));
      setLoading(false);
    })();
  }, [consorcio.id, anio]);

  const tot = (k: keyof Mes) => round2(meses.reduce((a, m) => a + Number(m[k]), 0));
  const totalDeuda = round2(deudores.reduce((a, d) => a + d.saldo, 0));
  const dispFinal = round2(cuentasRes.reduce((a, c) => a + c.final, 0));

  const exportar = () => {
    exportCSV(`rendicion-${consorcio.nombre}-${anio}.csv`, ['Mes', 'Gastos liquidados', 'Expensas emitidas', 'Cobrado', 'Pagado a proveedores', 'Sueldos (costo total)'],
      [...meses.map((m) => [m.mes, m.gastos, m.emitido, m.cobrado, m.pagado, m.sueldos]), ['TOTAL', tot('gastos'), tot('emitido'), tot('cobrado'), tot('pagado'), tot('sueldos')], [], ['Rubro', 'Monto', 'Cantidad'], ...rubros.map((r) => [r.rubro, r.monto, r.cant]), [], ['Cuenta', 'Saldo 1/1', 'Ingresos', 'Egresos', 'Saldo 31/12'], ...cuentasRes.map((c) => [c.nombre, c.inicial, c.ing, c.egr, c.final]), [], ['Deudores al 31/12', 'UF', 'Depto', 'Propietario', 'Saldo'], ...deudores.map((d) => ['', d.uf, d.depto, d.propietario, d.saldo])]);
  };
  const exportarGastos = () => exportCSV(`gastos-${consorcio.nombre}-${anio}.csv`, ['Fecha', 'Período liquidado', 'Rubro', 'Proveedor', 'CUIT', 'Descripción', 'Cat.', 'Tipo comprobante', 'N° comprobante', 'Monto', 'Pagado', 'Fecha pago'],
    gastosDetalle.map((g) => [g.fecha, g.periodo, g.rubro, g.proveedor, g.cuit, g.descripcion, g.categoria, g.tipo_comprobante, g.comprobante, g.monto, g.pagado, g.fecha_pago] as (string | number)[]));

  const imprimir = () => {
    const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const num = (v: number) => (Math.abs(v) < 0.005 ? '—' : `${v < 0 ? '−' : ''}${nf.format(Math.abs(v))}`);
    const suma = (v: number[]) => round2(v.reduce((a, x) => a + x, 0));
    // Se muestran los meses hasta el último con movimiento
    const cobrado = meses.map((m) => m.cobrado);
    const totIng = MESES.map((_, i) => round2(cobrado[i] + otrosIng[i]));
    const totEgr = MESES.map((_, i) => round2(egresosMes.reduce((a, r) => a + r.vals[i], 0)));
    let n = 12; while (n > 1 && !totIng[n - 1] && !totEgr[n - 1] && !cajaMes.ing[n - 1] && !cajaMes.egr[n - 1]) n--;
    const ms = MESES.slice(0, n); const c = (v: number[]) => v.slice(0, n);
    const td = (v: number, cls = '') => `<td class="n ${cls}${v < -0.005 ? ' neg' : ''}">${num(v)}</td>`;
    const fila = (nombre: string, vals: number[], cls = '', conTotal = true) => `<tr class="${cls}"><th>${escHtml(nombre)}</th>${c(vals).map((v) => td(v)).join('')}${conTotal ? td(suma(c(vals)), 'tot') : ''}</tr>`;
    const resultado = MESES.map((_, i) => round2(totIng[i] - totEgr[i]));
    const ti = suma(c(totIng)), te = suma(c(totEgr));
    // Caja: saldo inicial y final de cada mes, todas las cuentas juntas
    const ini0 = round2(cuentasRes.reduce((a, x) => a + x.inicial, 0));
    const cajaIni: number[] = [], cajaFin: number[] = []; let s = ini0;
    for (let i = 0; i < 12; i++) { cajaIni.push(s); s = round2(s + cajaMes.ing[i] - cajaMes.egr[i]); cajaFin.push(s); }
    const periodo = `${anio} · ${n === 12 ? 'enero a diciembre' : n === 1 ? 'enero' : `enero a ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][n - 1]}`}`;
    // Gráfico de barras: ingresos y egresos por mes
    const W = 1000, H = 230, P = 40, max = Math.max(1, ...c(totIng), ...c(totEgr)), bw = (W - 2 * P) / n, esc = (v: number) => (H - 34) * Math.max(0, v) / (max * 1.08);
    const paso = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 1 : 0.5);
    const corto = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('es-AR')} M` : v >= 1e3 ? `${(v / 1e3).toLocaleString('es-AR')} mil` : String(v));
    let grafico = '';
    for (let v = 0; v <= max * 1.05; v += paso) grafico += `<line x1="${P}" x2="${W - P}" y1="${H - 24 - esc(v)}" y2="${H - 24 - esc(v)}" stroke="#e3e9f4"/><text x="${P - 6}" y="${H - 20 - esc(v)}" text-anchor="end" font-size="11" fill="#94a3b8">${corto(v)}</text>`;
    ms.forEach((m, i) => { const x = P + i * bw;
      grafico += `<rect x="${x + bw * 0.16}" y="${H - 24 - esc(totIng[i])}" width="${bw * 0.32}" height="${esc(totIng[i])}" rx="3" fill="#2bb8b4"/><rect x="${x + bw * 0.52}" y="${H - 24 - esc(totEgr[i])}" width="${bw * 0.32}" height="${esc(totEgr[i])}" rx="3" fill="#1b4a9e"/><text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="#64748f">${m}</text>`; });
    const cab = (t: string) => `<header><div><h1>${t}</h1><div class="sub">${escHtml(consorcio.nombre)} · ${periodo}</div></div><div class="adm"><b>${escHtml(admin?.nombre || 'Administración')}</b>${admin?.rpa ? `RPA N° ${escHtml(admin.rpa)}` : 'Administración'}</div></header>`;
    const thMeses = `<tr><th></th>${ms.map((m) => `<th class="n">${m}</th>`).join('')}`;
    const html = `<table class="pag"><thead><tr><td class="margen"></td></tr></thead><tfoot><tr><td class="margen"></td></tr></tfoot><tbody><tr><td>
      <div class="hoja">${cab('Rendición de cuentas')}
        <div class="kpis"><div class="kpi"><span>Ingresos del período</span><b>$ ${num(ti)}</b></div><div class="kpi"><span>Egresos del período</span><b>$ ${num(te)}</b></div>
          <div class="kpi"><span>Resultado (ingresos − egresos)</span><b class="${ti - te < 0 ? 'neg' : 'pos'}">$ ${num(round2(ti - te))}</b></div><div class="kpi"><span>Disponible en caja y bancos</span><b>$ ${num(cajaFin[n - 1])}</b></div></div>
        <table class="t"><thead>${thMeses}<th class="n">Total</th></tr></thead><tbody>
          <tr class="sec"><th colspan="${n + 2}">Ingresos</th></tr>${fila('Cobranza de expensas', cobrado)}${suma(c(otrosIng)) ? fila('Otros ingresos', otrosIng) : ''}${fila('Total ingresos', totIng, 'total')}
          <tr class="sec"><th colspan="${n + 2}">Egresos</th></tr>${egresosMes.map((r) => fila(r.rubro, r.vals)).join('')}${fila('Total egresos', totEgr, 'total')}
          ${fila('Resultado del mes', resultado, 'result')}
        </tbody></table>
        <p class="nota">Importes en pesos. Ingresos: lo cobrado en cada mes. Egresos: gastos del mes por rubro, ordenados de mayor a menor.</p>
      </div>
      <div class="hoja">${cab('Evolución y caja')}
        <h2>Ingresos y egresos por mes</h2><div class="ley"><span><i style="background:#2bb8b4"></i>Ingresos</span><span><i style="background:#1b4a9e"></i>Egresos</span></div>
        <svg viewBox="0 0 ${W} ${H}" width="100%">${grafico}</svg>
        <h2>Movimiento de caja y bancos</h2>
        <table class="t"><thead>${thMeses}</tr></thead><tbody>${fila('Saldo inicial', cajaIni, '', false)}${fila('Ingresos', cajaMes.ing, '', false)}${fila('Egresos', cajaMes.egr, '', false)}${fila('Saldo final', cajaFin, 'total', false)}</tbody></table>
        ${cuentasRes.length > 1 ? `<h2>Saldos por cuenta</h2><table class="t angosta"><thead><tr><th></th><th class="n">Saldo inicial</th><th class="n">Ingresos</th><th class="n">Egresos</th><th class="n">Saldo final</th></tr></thead><tbody>${cuentasRes.map((x) => `<tr><th>${escHtml(x.nombre)}</th>${td(x.inicial)}${td(x.ing)}${td(x.egr)}${td(x.final)}</tr>`).join('')}</tbody></table>` : ''}
        <p class="nota">El saldo final de cada mes es el inicial del siguiente. No se cuentan las transferencias entre cuentas propias.</p>
      </div>
      <div class="hoja">${cab('Deudores y cierre')}
        <h2>Deudores al cierre</h2>${deudores.length ? `<table class="t angosta"><thead><tr><th>UF</th><th>Depto.</th><th>Propietario</th><th class="n">Saldo deudor</th></tr></thead><tbody>${deudores.map((d) => `<tr><th>${d.uf}</th><td>${escHtml(d.depto)}</td><td>${escHtml(d.propietario)}</td>${td(d.saldo)}</tr>`).join('')}<tr class="total"><th colspan="3">Total (${deudores.length} unidades)</th>${td(totalDeuda)}</tr></tbody></table>` : '<p class="nota">No hay unidades con deuda al cierre.</p>'}
        ${aFavor > 0 ? `<p class="nota">Saldos a favor de propietarios: $ ${num(aFavor)}.</p>` : ''}
        ${retenciones.length ? `<h2>Retenciones practicadas</h2><table class="t angosta"><tbody>${retenciones.map((r) => `<tr><th>${escHtml(r.tipo.toUpperCase())}</th>${td(r.monto)}</tr>`).join('')}</tbody></table>` : ''}
        <div class="firma"><div>${escHtml(admin?.nombre || 'Administración')}<br><span class="chico">Administrador/a</span></div><div>Consejo de propietarios<br><span class="chico">Conformidad</span></div></div>
      </div>
    </td></tr></tbody></table>`;
    // Margen de página en 0: el navegador no agrega fecha, hora, título ni dirección; el margen lo da la tabla .pag en cada hoja
    const css = `@page { size: A4 landscape; margin: 0; }
      body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1c2a44; font-size: 9.6pt; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      table.pag { width: 100%; border-collapse: collapse; margin: 0; } table.pag > thead > tr > td, table.pag > tfoot > tr > td, table.pag > tbody > tr > td { border: 0; padding: 0 12mm; } td.margen { height: 10mm; }
      .hoja { page-break-after: always; } .hoja:last-child { page-break-after: auto; }
      header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #12284f; padding-bottom: 8px; margin-bottom: 12px; }
      h1 { margin: 0; font-size: 20pt; color: #12284f; letter-spacing: -.3px; } .sub { color: #64748f; font-size: 10.5pt; margin-top: 2px; }
      header .adm { text-align: right; font-size: 9.5pt; color: #64748f; } header .adm b { display: block; color: #12284f; font-size: 11.5pt; }
      .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; } .kpi { border: 1px solid #d5deee; border-radius: 8px; padding: 8px 12px; }
      .kpi span { display: block; font-size: 8.5pt; color: #64748f; text-transform: uppercase; letter-spacing: .6px; } .kpi b { font-size: 15pt; color: #12284f; } .kpi b.neg { color: #b42318; } .kpi b.pos { color: #0f766e; }
      table.t { width: 100%; border-collapse: collapse; margin: 0; } table.t.angosta { width: 60%; } table.t th, table.t td { padding: 4.2px 6px; border: 0; font-size: 9.6pt; text-transform: none; color: inherit; }
      table.t thead th { background: #12284f; color: #fff; font-size: 8.8pt; font-weight: 600; } table.t tbody th { text-align: left; font-weight: 400; white-space: nowrap; }
      table.t tbody tr { border-bottom: 1px solid #e3e9f4; } table.t tr.sec th { background: #eaf0fa; color: #12284f; font-weight: 700; text-transform: uppercase; font-size: 8.4pt; letter-spacing: .8px; }
      table.t tr.total { background: #f3f6fb; } table.t tr.total th, table.t tr.total td { font-weight: 700; color: #12284f; border-top: 1.5px solid #12284f; }
      table.t tr.result th, table.t tr.result td { font-weight: 700; background: #12284f; color: #fff; } table.t tr.result td.neg { color: #ffb4a8; }
      table.t td.tot { font-weight: 700; background: #f3f6fb; } table.t td.neg { color: #b42318; } table.t tr.result td.tot { background: #12284f; }
      h2 { font-size: 12pt; color: #12284f; margin: 14px 0 6px; border: 0; padding: 0; } .nota { color: #64748f; font-size: 8.4pt; margin: 6px 0 0; }
      .ley { display: flex; gap: 16px; font-size: 9pt; color: #33415c; margin-bottom: 2px; } .ley i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }
      .firma { margin-top: 50px; } @media screen { body { background: #e9edf3; } table.pag { background: #fff; max-width: 297mm; margin: 12px auto; box-shadow: 0 2px 12px rgba(15, 34, 71, .15); } }`;
    imprimirHtml(`Rendición ${consorcio.nombre} ${anio}`, html, css);
  };

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32"><Input label="Ejercicio" type="number" value={anio} onChange={setAnio} /></div>
          <Button onClick={imprimir} disabled={loading}><Printer size={15} /> Rendición en PDF</Button>
          <Button variant="secondary" onClick={exportar} disabled={loading}><Download size={15} /> Exportar resumen</Button>
          <Button variant="secondary" onClick={exportarGastos} disabled={loading}><Download size={15} /> Gastos del año (para el contador)</Button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Para la asamblea y la DDJJ anual del RPA. Toma liquidaciones cerradas, cobranzas, pagos, sueldos y movimientos de caja del ejercicio. Los sueldos se exportan desde Sueldos → "Para el contador", y las retenciones desde la pestaña Retenciones.</p>
      </Card>
      {loading ? <Spinner /> : <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
          {[{ l: 'Gastos liquidados', v: tot('gastos') }, { l: 'Cobrado en el año', v: tot('cobrado') }, { l: 'Disponible al 31/12', v: dispFinal }, { l: `Deuda al 31/12 (${deudores.length} UF)`, v: totalDeuda, warn: true }].map((k) => (
            <div key={k.l} className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{k.l}</div><div className={`text-lg font-bold ${k.warn && k.v > 0 ? 'text-red-500' : ''}`}>{fmtMoney(k.v)}</div></div>
          ))}
        </div>
        <Card className="mb-4">
          <h3 className="font-semibold text-slate-700 mb-3">Mes a mes · {anio}</h3>
          <Table headers={['Mes', 'Gastos liquidados', 'Expensas emitidas', 'Cobrado', 'Pagado a proveedores', 'Sueldos y cargas']}
            footer={<tr className="bg-slate-50 font-bold"><Td>Total</Td><Td>{fmtMoney(tot('gastos'))}</Td><Td>{fmtMoney(tot('emitido'))}</Td><Td className="text-emerald-600">{fmtMoney(tot('cobrado'))}</Td><Td className="text-red-500">{fmtMoney(tot('pagado'))}</Td><Td>{fmtMoney(tot('sueldos'))}</Td></tr>}>
            {meses.map((m) => <tr key={m.mes} className="hover:bg-slate-50"><Td className="font-medium">{m.mes}</Td><Td>{fmtMoney(m.gastos)}</Td><Td>{fmtMoney(m.emitido)}</Td><Td className="text-emerald-600">{fmtMoney(m.cobrado)}</Td><Td className="text-red-500">{fmtMoney(m.pagado)}</Td><Td>{fmtMoney(m.sueldos)}</Td></tr>)}
          </Table>
        </Card>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <h3 className="font-semibold text-slate-700 mb-3">Gastos por rubro</h3>
            <Table headers={['Rubro', 'Cant.', 'Importe', '%']}>
              {rubros.map((r) => <tr key={r.rubro} className="hover:bg-slate-50"><Td>{r.rubro}</Td><Td>{r.cant}</Td><Td className="font-medium">{fmtMoney(r.monto)}</Td><Td className="text-slate-500">{tot('gastos') ? (r.monto / tot('gastos') * 100).toFixed(1) : 0}%</Td></tr>)}
              {rubros.length === 0 && <tr><Td colSpan={4} className="text-center text-slate-400 py-6">Sin gastos en {anio}</Td></tr>}
            </Table>
          </Card>
          <Card>
            <h3 className="font-semibold text-slate-700 mb-3">Caja y bancos</h3>
            <Table headers={['Cuenta', 'Saldo 1/1', 'Ingresos', 'Egresos', 'Saldo 31/12']}>
              {cuentasRes.map((c) => <tr key={c.nombre} className="hover:bg-slate-50"><Td className="font-medium">{c.nombre}</Td><Td>{fmtMoney(c.inicial)}</Td><Td className="text-emerald-600">{fmtMoney(c.ing)}</Td><Td className="text-red-500">{fmtMoney(c.egr)}</Td><Td className="font-semibold">{fmtMoney(c.final)}</Td></tr>)}
            </Table>
            {retenciones.length > 0 && <p className="text-xs text-slate-500 mt-3">Retenciones practicadas en el año: {retenciones.map((r) => `${r.tipo.toUpperCase()} ${fmtMoney(r.monto)}`).join(' · ')}</p>}
          </Card>
          <Card className="lg:col-span-2">
            <h3 className="font-semibold text-slate-700 mb-3">Deudores al 31/12/{anio}</h3>
            <Table headers={['UF', 'Depto', 'Propietario', 'Saldo deudor']}>
              {deudores.map((d) => <tr key={d.uf} className="hover:bg-slate-50"><Td>{d.uf}</Td><Td>{d.depto}</Td><Td>{d.propietario}</Td><Td className="text-red-500 font-medium">{fmtMoney(d.saldo)}</Td></tr>)}
              {deudores.length === 0 && <tr><Td colSpan={4} className="text-center text-slate-400 py-6">Sin deudores</Td></tr>}
            </Table>
          </Card>
        </div>
      </>}
    </>
  );
}

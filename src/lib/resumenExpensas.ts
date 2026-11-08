import { supabase, type Administracion, type Consorcio, type Cupon, type Gasto, type Liquidacion, type Rubro, type Unidad } from './supabase';
import { fmtDate, fmtMoney, periodoLabel, round2 } from './engine';
import { escHtml, imprimirHtml } from './imprimir';

/*
  "Resumen" de la liquidación: el PDF de expensas con el formato habitual (tipo "Programa mis expensas"):
  encabezado administración / edificio / expensas, importante, enlaces de acceso (QR), gastos por rubro con columnas
  A/B/C/D, total de gastos, estado financiero y patrimonial, notas y normas, y el estado de cuentas y prorrateo por UF.
  Sirve tanto para "Simular" (con cupones generados sobre una liquidación abierta) como para el resumen definitivo.
*/

const COLS: { key: 'a' | 'b' | 'c' | 'd'; titulo: string }[] = [
  { key: 'a', titulo: 'Expensas ordinarias (A)' }, { key: 'b', titulo: 'Cocheras (B)' }, { key: 'c', titulo: 'Fondo extraordinario (C)' }, { key: 'd', titulo: 'Particulares (D)' },
];
const qr = (data: string) => `<img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(data)}" width="110" height="110" alt="QR">`;
const n = (v: unknown) => fmtMoney(Number(v) || 0);

export async function imprimirResumenExpensas(liq: Liquidacion, consorcio: Consorcio, simulacion = false) {
  const [{ data: adm }, { data: gastos }, { data: cupones }, { data: rubros }, { data: unidades }, { data: cuentas }, { data: movs }, { data: anterior }, { data: ops }, { data: impagos }] = await Promise.all([
    supabase.from('administracion').select('*').limit(1).maybeSingle(),
    supabase.from('gastos').select('*, proveedores(nombre, cuit), rubros(nombre, orden)').eq('liquidacion_id', liq.id).order('fecha'),
    supabase.from('cupones').select('*, unidades(*)').eq('liquidacion_id', liq.id),
    supabase.from('rubros').select('*').order('orden'),
    supabase.from('unidades').select('*').eq('consorcio_id', liq.consorcio_id).eq('activo', true).order('uf'),
    supabase.from('cuentas').select('*').eq('consorcio_id', liq.consorcio_id).eq('activa', true),
    supabase.from('movimientos').select('cuenta_id, fecha, tipo, monto').eq('consorcio_id', liq.consorcio_id).lte('fecha', `${liq.periodo}-31`),
    supabase.from('liquidaciones').select('cerrada_at, periodo').eq('consorcio_id', liq.consorcio_id).lt('periodo', liq.periodo).neq('estado', 'abierta').order('periodo', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('ordenes_pago').select('monto').eq('consorcio_id', liq.consorcio_id).eq('estado', 'pendiente'),
    supabase.from('gastos').select('monto').eq('consorcio_id', liq.consorcio_id).eq('pagado', false).is('orden_pago_id', null),
  ]);
  const a = adm as Administracion | null;
  const gs = (gastos || []) as Gasto[];
  const cs = ((cupones || []) as Cupon[]).sort((x, y) => (x.unidades?.uf || 0) - (y.unidades?.uf || 0));
  const us = (unidades || []) as Unidad[];
  const rs = (rubros || []) as Rubro[];

  // Pagos recibidos desde el cierre anterior (para mostrar saldo anterior bruto / pagos / deuda)
  const desde = (anterior as { cerrada_at: string | null } | null)?.cerrada_at?.slice(0, 10) || `${liq.periodo}-01`;
  const { data: pagosRec } = await supabase.from('pagos').select('unidad_id, monto').eq('consorcio_id', liq.consorcio_id).gte('fecha', desde).lte('fecha', liq.cerrada_at?.slice(0, 10) || '9999-12-31');
  const pagosPorUnidad: Record<string, number> = {};
  for (const p of (pagosRec || []) as { unidad_id: string; monto: number }[]) pagosPorUnidad[p.unidad_id] = round2((pagosPorUnidad[p.unidad_id] || 0) + Number(p.monto));

  // Totales por columna
  const tot = { a: 0, b: 0, c: 0, d: 0 };
  for (const g of gs) { tot.a += Number(g.monto_a); tot.b += Number(g.monto_b); tot.c += Number(g.monto_c); tot.d += Number(g.monto_d); }
  const colsUsadas = COLS.filter((c) => tot[c.key] > 0.005);
  const totalGastos = round2(tot.a + tot.b + tot.c + tot.d);

  // Gastos por rubro
  const grupos = [...rs.map((r) => ({ nombre: r.nombre, items: gs.filter((g) => g.rubro_id === r.id) })), { nombre: 'Sin rubro', items: gs.filter((g) => !g.rubro_id) }].filter((x) => x.items.length);
  const filaGasto = (g: Gasto) => `<tr><td>${escHtml(g.descripcion)}${g.proveedores?.nombre ? ` <span class="mut">· ${escHtml(g.proveedores.nombre)}</span>` : ''}${g.comprobante ? ` <span class="mut chico">· ${escHtml(g.tipo_comprobante || '')} ${escHtml(g.comprobante)}</span>` : ''}${g.periodo_facturado ? ` <span class="mut chico">· ${escHtml(g.periodo_facturado)}</span>` : ''}</td>${colsUsadas.map((c) => `<td class="n">${Number(g[`monto_${c.key}` as keyof Gasto]) ? n(g[`monto_${c.key}` as keyof Gasto]) : ''}</td>`).join('')}<td class="n"><b>${n(g.monto)}</b></td></tr>`;
  const tablaGastos = grupos.map((gr, i) => {
    const sub = round2(gr.items.reduce((s, g) => s + Number(g.monto), 0));
    return `<tr class="rubro"><td colspan="${colsUsadas.length + 2}">${i + 1}. ${escHtml(gr.nombre.toUpperCase())} <span class="chico">(${totalGastos ? (sub / totalGastos * 100).toFixed(1) : 0}%)</span></td></tr>${gr.items.map(filaGasto).join('')}<tr class="sub"><td class="n" colspan="${colsUsadas.length + 1}">Total ${escHtml(gr.nombre)}</td><td class="n">${n(sub)}</td></tr>`;
  }).join('');

  // Estado financiero del período (caja y bancos)
  const d1 = `${liq.periodo}-01`;
  type M = { cuenta_id: string | null; fecha: string; tipo: string; monto: number };
  const ms = (movs || []) as M[];
  const cu = (cuentas || []) as { id: string; saldo_inicial: number; fecha_saldo_inicial: string }[];
  const saldoAl = (f: string) => round2(cu.reduce((s, c) => s + (f > c.fecha_saldo_inicial ? Number(c.saldo_inicial) : 0) + ms.filter((m) => m.cuenta_id === c.id && m.fecha >= c.fecha_saldo_inicial && m.fecha < f).reduce((x, m) => x + (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto)), 0), 0));
  const saldoInicial = saldoAl(d1);
  const delMes = ms.filter((m) => m.fecha >= d1 && m.cuenta_id);
  const ingresos = round2(delMes.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0));
  const egresos = round2(delMes.filter((m) => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0));
  const saldoCierre = round2(saldoInicial + ingresos - egresos);
  const expensasACobrar = round2(cs.reduce((s, c) => s + Number(c.total), 0));
  const deudasAnteriores = round2(cs.reduce((s, c) => s + Math.max(0, Number(c.saldo_anterior)), 0));
  const aPagar = round2(((ops || []) as { monto: number }[]).reduce((s, o) => s + Number(o.monto), 0) + ((impagos || []) as { monto: number }[]).reduce((s, g) => s + Number(g.monto), 0));

  // Estado de cuentas y prorrateo
  const coef = (u: Unidad | undefined, k: 'a' | 'b' | 'c' | 'd') => Number(u?.[`coef_${k}` as keyof Unidad] || 0);
  const filasCupon = cs.map((c) => {
    const u = c.unidades || us.find((x) => x.id === c.unidad_id);
    const pag = pagosPorUnidad[c.unidad_id] || 0;
    const saldoAntBruto = round2(Number(c.saldo_anterior) + pag);
    const gastosCupon = round2(Number(c.monto_a) + Number(c.monto_b) + Number(c.monto_c) + Number(c.monto_d));
    const redondeo = round2(Number(c.total) - gastosCupon - Number(c.saldo_anterior) - Number(c.intereses));
    return `<tr><td>${String(u?.uf ?? '').padStart(3, '0')}</td><td>${escHtml(u?.depto || '')}</td><td>${escHtml(u?.propietario || '')}</td><td class="n">${n(saldoAntBruto)}</td><td class="n">${pag ? n(pag) : ''}</td><td class="n">${Number(c.saldo_anterior) > 0 ? n(c.saldo_anterior) : ''}</td><td class="n">${Number(c.intereses) ? n(c.intereses) : ''}</td><td class="n">${Number(c.saldo_anterior) < 0 ? n(-Number(c.saldo_anterior)) : ''}</td>${colsUsadas.map((k) => `<td class="n chico">${coef(u, k.key).toFixed(2)}%</td><td class="n">${n(c[`monto_${k.key}` as keyof Cupon])}</td>`).join('')}<td class="n">${redondeo ? n(redondeo) : ''}</td><td class="n"><b>${n(c.total)}</b></td><td class="n">${n(c.total_2do_venc)}</td></tr>`;
  }).join('');
  const totCup = (k: keyof Cupon) => round2(cs.reduce((s, c) => s + Number(c[k] || 0), 0));

  const titulo = `${simulacion ? 'SIMULACIÓN · ' : ''}EXPENSAS - Liquidación de ${periodoLabel(liq.periodo)}`;
  const html = `
    ${simulacion ? '<div class="caja" style="background:#fef3c7;border-color:#f59e0b;text-align:center"><b>SIMULACIÓN</b> — la liquidación sigue abierta; los importes pueden cambiar hasta el cierre.</div>' : ''}
    <div class="cab"><div><h1>${escHtml(a?.nombre || 'Administración')}</h1><div class="adm">${titulo}</div></div><div class="doc"><b>${escHtml(consorcio.nombre)}</b>${escHtml(consorcio.direccion || '')}</div></div>
    <table class="grid3"><tr>
      <td><h3>Administración</h3>${escHtml(a?.nombre || '')}<br>${escHtml(a?.direccion || '')}<br>${a?.telefono ? `Tel: ${escHtml(a.telefono)}<br>` : ''}${a?.email ? `${escHtml(a.email)}<br>` : ''}${a?.cuit ? `CUIT: ${escHtml(a.cuit)}<br>` : ''}${a?.rpa ? `Inscripción R.P.A.: ${escHtml(a.rpa)}` : ''}</td>
      <td><h3>Edificio</h3>${escHtml(consorcio.nombre)}<br>${escHtml(consorcio.direccion || '')}${consorcio.ciudad ? `, ${escHtml(consorcio.ciudad)}` : ''}<br>${consorcio.cuit ? `CUIT: ${escHtml(consorcio.cuit)}<br>` : ''}${consorcio.cbu ? `CBU: ${escHtml(consorcio.cbu)}` : ''}</td>
      <td><h3>Expensas</h3>Período: <b>${escHtml(liq.nombre || periodoLabel(liq.periodo))}</b><br>1er vencimiento: ${fmtDate(liq.fecha_vencimiento_1)}<br>2do vencimiento: ${fmtDate(liq.fecha_vencimiento_2)} (+${liq.recargo_2do_venc_pct}%)<br>${Number(liq.interes_mora_pct) ? `Interés por mora: ${liq.interes_mora_pct}% mensual` : ''}</td>
    </tr></table>
    ${a?.telefono ? `<h2>Importante</h2><p>En caso de urgencia: ${escHtml(a.telefono)} · ${escHtml(a.nombre || '')}</p>` : ''}
    <h2>Enlaces de acceso</h2>
    <table class="grid3"><tr>
      <td style="width:50%"><div style="display:flex;gap:10px;align-items:center">${qr('https://www.afip.gob.ar/aportesenlinea')}<div class="chico">Mediante el siguiente enlace <b>www.afip.gob.ar/aportesenlinea</b> o QR podrá ingresar a los datos acerca del estado de los pagos efectuados correspondientes a los aportes y contribuciones a la seguridad social, con clave fiscal y el CUIL del empleado.</div></div></td>
      <td>${consorcio.url_comprobantes ? `<div style="display:flex;gap:10px;align-items:center">${qr(consorcio.url_comprobantes)}<div class="chico">Mediante el QR podrá acceder al listado de comprobantes ingresados por el administrador, correspondientes al período actual.</div></div>` : '<span class="chico mut">Los comprobantes de cada gasto se consultan en el portal de vecinos.</span>'}</td>
    </tr></table>
    <h2>Detalle de gastos del período</h2>
    <table><thead><tr><th>Rubro / Concepto</th>${colsUsadas.map((c) => `<th class="n">${c.titulo}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>${tablaGastos}
    <tr class="total"><td>TOTAL DE GASTOS</td>${colsUsadas.map((c) => `<td class="n">${n(tot[c.key])}</td>`).join('')}<td class="n">${n(totalGastos)}</td></tr></tbody></table>
    <table class="grid3"><tr>
      <td><h3>Estado financiero (caja y bancos)</h3><table><tr><td>Saldo inicial</td><td class="n">${n(saldoInicial)}</td></tr><tr><td>Ingresos del mes</td><td class="n">${n(ingresos)}</td></tr><tr><td>Egresos del mes</td><td class="n">${n(egresos)}</td></tr><tr class="total"><td>Saldo al cierre</td><td class="n">${n(saldoCierre)}</td></tr></table></td>
      <td><h3>Estado patrimonial</h3><table><tr><td>Disponibilidades al cierre</td><td class="n">${n(saldoCierre)}</td></tr><tr><td>Expensas a cobrar (esta liquidación)</td><td class="n">${n(expensasACobrar)}</td></tr><tr><td>Deudas de unidades anteriores</td><td class="n">${n(deudasAnteriores)}</td></tr><tr><td>Proveedores a pagar</td><td class="n">${n(aPagar)}</td></tr><tr class="total"><td>Patrimonio neto estimado</td><td class="n">${n(round2(saldoCierre + expensasACobrar - aPagar))}</td></tr></table></td>
    </tr></table>
    ${liq.notas ? `<h2>Notas</h2><div class="caja" style="white-space:pre-wrap">${escHtml(liq.notas)}</div>` : ''}
    ${cs.length ? `<h2 style="page-break-before:always">Estado de cuentas y prorrateo de gastos</h2>
    <table class="chico"><thead><tr><th>UF</th><th>Depto</th><th>Propietario</th><th class="n">Saldo ant.</th><th class="n">Pagos recib.</th><th class="n">Deuda</th><th class="n">Interés</th><th class="n">A favor</th>${colsUsadas.map((c) => `<th class="n">% ${c.key.toUpperCase()}</th><th class="n">${c.titulo}</th>`).join('')}<th class="n">Redon.</th><th class="n">TOTAL 1º vto</th><th class="n">2º vto</th></tr></thead>
    <tbody>${filasCupon}<tr class="total"><td colspan="3">TOTALES</td><td></td><td class="n">${n(Object.values(pagosPorUnidad).reduce((s, v) => s + v, 0))}</td><td class="n">${n(deudasAnteriores)}</td><td class="n">${n(totCup('intereses'))}</td><td></td>${colsUsadas.map((c) => `<td></td><td class="n">${n(totCup(`monto_${c.key}` as keyof Cupon))}</td>`).join('')}<td></td><td class="n">${n(totCup('total'))}</td><td class="n">${n(totCup('total_2do_venc'))}</td></tr></tbody></table>` : '<p class="mut">Todavía no hay cupones generados: usá "Simular" para ver el prorrateo.</p>'}
    <p class="chico mut" style="margin-top:14px">${escHtml(a?.nombre || '')}${a?.rpa ? ` · R.P.A. ${escHtml(a.rpa)}` : ''} · Liquidación emitida el ${fmtDate(new Date().toISOString().slice(0, 10))}. Los importes vencen en las fechas indicadas; pasado el 1er vencimiento se aplica el recargo del 2do, y luego el interés por mora.</p>`;
  imprimirHtml(`${consorcio.nombre} - Expensas ${liq.periodo}`, html, `
    .grid3 { border-collapse:separate; border-spacing:8px 0; margin:6px -8px 10px; } .grid3 > tbody > tr > td { vertical-align:top; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; width:33%; }
    .grid3 table { margin:0; } .grid3 td td { border:0; border-bottom:1px solid #e2e8f0; padding:3px 4px; }
    tr.rubro td { background:#1e2a4a; color:#fff; font-weight:bold; font-size:11px; padding:5px 6px; } tr.sub td { font-weight:bold; background:#f1f5f9; }
    table.chico td, table.chico th { font-size:9.5px; padding:3px 4px; } .grid3 h3 { margin:0 0 4px; }
    @page { size: A4; margin: 12mm 10mm; }`);
}

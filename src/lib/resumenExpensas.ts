import { supabase, type Administracion, type Consorcio, type Cupon, type Gasto, type Liquidacion, type Rubro, type SueldoLiquidacion, type Unidad } from './supabase';
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
  const { data: sueldosData } = await supabase.from('sueldo_liquidaciones').select('*, empleados(*)').eq('consorcio_id', liq.consorcio_id).eq('periodo', liq.periodo);
  const sueldos = (sueldosData || []) as SueldoLiquidacion[];
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
  const filaGasto = (g: Gasto) => `<tr><td>${escHtml(g.descripcion)}${g.proveedores?.nombre ? ` <span class="mut">· ${escHtml(g.proveedores.nombre)}${g.proveedores.cuit ? ` · CUIT ${escHtml(g.proveedores.cuit)}` : ''}</span>` : ''}${g.comprobante ? ` <span class="mut chico">· ${escHtml(g.tipo_comprobante || '')} ${escHtml(g.comprobante)}</span>` : ''}${g.periodo_facturado ? ` <span class="mut chico">· ${escHtml(g.periodo_facturado)}</span>` : ''}</td>${colsUsadas.map((c) => `<td class="n">${Number(g[`monto_${c.key}` as keyof Gasto]) ? n(g[`monto_${c.key}` as keyof Gasto]) : ''}</td>`).join('')}<td class="n"><b>${n(g.monto)}</b></td></tr>`;
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

  const titulo = `${simulacion ? 'SIMULACIÓN · ' : ''}EXPENSAS - Liquidación de ${escHtml(liq.nombre || periodoLabel(liq.periodo))}`;
  const sec = (h: string, cuerpo: string, ref = '', extra = '') => `<div class="sec ${extra}"><div class="sec-h">${ref ? `<span class="ref">${ref}</span>` : ''}<span>${h}</span></div><div class="sec-b">${cuerpo}</div></div>`;
  const fp = [consorcio.banco ? `LAS EXPENSAS SE DEPOSITAN EN ${escHtml(consorcio.banco.toUpperCase())}` : '', consorcio.cbu ? `CBU / CTA: ${escHtml(consorcio.cbu)}` : '', a?.email ? `COMPROBANTE POR MAIL A: <b>${escHtml(a.email)}</b>` : '', a?.telefono ? `WA ${escHtml(a.telefono)}` : ''].filter(Boolean);

  // Remuneraciones al personal (detalle del recibo de cada empleado del período), como exige la Ley 941
  const bloqueSueldos = sueldos.map((sl) => {
    const e = sl.empleados; const lineas = sl.detalle || [];
    const li = (tipo: 'rem' | 'norem' | 'desc') => lineas.filter((x) => x.tipo === tipo).map((x) => `<tr><td>${escHtml(x.concepto)}${x.detalle ? ` <span class="mut">(${escHtml(x.detalle)})</span>` : ''}</td><td class="n">${n(x.monto)}</td></tr>`).join('');
    return `<div class="emp"><div class="cols3" style="margin-bottom:4px"><div>Apellido / Nombre: <b>${escHtml(e?.nombre || '')}</b><br>Cargo: <b>${escHtml((e?.cargo || '').replace('_', ' '))}${e?.vive_en_edificio ? ' con vivienda' : ' sin vivienda'}</b></div><div>CUIL: <b>${escHtml(e?.cuil || '')}</b><br>Categoría: <b>${escHtml(e?.categoria || '')}</b></div><div>Período: <b>${escHtml(periodoLabel(sl.periodo))}</b><br>Fecha ingreso: <b>${fmtDate(e?.antiguedad_fecha)}</b></div></div>
      <table class="t"><tr class="sub"><td>Haberes remunerativos</td><td class="n">${n(sl.bruto)}</td></tr>${li('rem')}${Number(sl.no_remunerativo) ? `<tr class="sub"><td>No remunerativo</td><td class="n">${n(sl.no_remunerativo)}</td></tr>${li('norem')}` : ''}<tr class="sub"><td>Deducciones</td><td class="n">${n(round2(Number(sl.aportes) + Number(sl.descuentos)))}</td></tr>${li('desc')}<tr class="total"><td>Total neto</td><td class="n">${n(sl.neto)}</td></tr><tr><td>Contribuciones patronales (a cargo del consorcio)</td><td class="n">${n(sl.contribuciones)}</td></tr><tr class="total"><td>Costo total del período</td><td class="n">${n(sl.costo_total)}</td></tr></table></div>`;
  }).join('');

  const html = `
    ${simulacion ? '<div class="caja" style="background:#fef3c7;border-color:#f59e0b;text-align:center"><b>SIMULACIÓN</b> — la liquidación sigue abierta; los importes pueden cambiar hasta el cierre.</div>' : ''}
    <p class="chico mut center" style="margin:0 0 6px">Modelo de liquidación de expensas conforme disposición</p>
    <div class="sec"><div class="sec-h big"><span>${escHtml((a?.nombre || 'ADMINISTRACIÓN').toUpperCase())}<br>${titulo}</span></div>
      <div class="sec-b cols3">
        <div><b>ADMINISTRACIÓN</b><br>Nombre: <b>${escHtml(a?.nombre || '')}</b><br>Domicilio: <b>${escHtml(a?.direccion || '')}</b><br>${a?.telefono ? `Teléfono: <b>${escHtml(a.telefono)}</b><br>` : ''}${a?.email ? `Mail: <b>${escHtml(a.email)}</b><br>` : ''}${a?.cuit ? `CUIT: <b>${escHtml(a.cuit)}</b><br>` : ''}${a?.rpa ? `Inscripción R.P.A.: <b>${escHtml(a.rpa)}</b>` : ''}</div>
        <div><b>EDIFICIO</b><br>Nombre: <b>${escHtml(consorcio.nombre)}</b><br>Dirección: <b>${escHtml(consorcio.direccion || '')}${consorcio.ciudad ? `, ${escHtml(consorcio.ciudad)}` : ''}</b><br>${consorcio.cuit ? `CUIT: <b>${escHtml(consorcio.cuit)}</b><br>` : ''}${consorcio.cbu ? `CBU: <b>${escHtml(consorcio.cbu)}</b>` : ''}</div>
        <div><b>EXPENSAS</b><br>Período: <b>${escHtml(liq.nombre || periodoLabel(liq.periodo))}</b><br>1er Vencimiento: <b>${fmtDate(liq.fecha_vencimiento_1)}</b><br>2do Vencimiento: <b>${fmtDate(liq.fecha_vencimiento_2)}</b> (+${liq.recargo_2do_venc_pct}%)<br>${Number(liq.interes_mora_pct) ? `Interés por mora: <b>${liq.interes_mora_pct}% mensual</b>` : ''}</div>
      </div></div>
    ${sec('IMPORTANTE', `En caso de urgencia &nbsp; ${escHtml(a?.telefono || '')} &nbsp; ${escHtml(a?.nombre || '')}`)}
    ${sec('ENLACES DE ACCESO', `<div class="cols2"><div class="qrrow">${qr('https://www.afip.gob.ar/aportesenlinea')}<div class="chico">Mediante el siguiente enlace <b>https://www.afip.gob.ar/aportesenlinea</b> o QR, podrá ingresar a los datos acerca del estado de los pagos efectuados correspondientes a los aportes y contribuciones a la seguridad social, con clave fiscal y el CUIL del empleado.</div></div>
      <div class="qrrow">${consorcio.url_comprobantes ? `${qr(consorcio.url_comprobantes)}<div class="chico">Mediante el <b>siguiente link</b> o QR podrá acceder al listado de comprobantes ingresados por el administrador, correspondientes al período actual.</div>` : '<div class="chico mut">Los comprobantes de cada gasto se consultan en el portal de vecinos.</div>'}</div></div>`, '(Conf disp DI-2024-1146-GCABA-DGDYPC)')}
    ${sueldos.length ? sec('REMUNERACIONES AL PERSONAL Y CARGAS SOCIALES', bloqueSueldos, '(Conf. Art. 10 inc d Ley Nº 941)') : ''}
    ${sec('DETALLE DE GASTOS DEL PERÍODO', `<table class="t"><thead><tr><th>RUBROS - CONCEPTO</th>${colsUsadas.map((c) => `<th class="n">${c.titulo}</th>`).join('')}<th class="n">TOTAL</th></tr></thead><tbody>${tablaGastos}</tbody></table>`, '(Conf. Art. 10 inc e y f Ley Nº 941)')}
    ${sec('TOTAL DE GASTOS', `<table class="t"><thead><tr><th></th>${colsUsadas.map((c) => `<th class="n">${c.titulo}</th>`).join('')}<th class="n">TOTAL</th></tr></thead><tbody><tr class="total"><td>TOTALES</td>${colsUsadas.map((c) => `<td class="n">${n(tot[c.key])}</td>`).join('')}<td class="n">${n(totalGastos)}</td></tr></tbody></table>`)}
    ${sec('ESTADO FINANCIERO', `<div class="subh">RESUMEN DE MOVIMIENTOS CAJA</div><table class="t"><tr class="sub"><td>SALDO INICIAL</td><td class="n">${n(saldoInicial)}</td></tr><tr><td>INGRESOS DEL MES (cobros de expensas y otros)</td><td class="n">${n(ingresos)}</td></tr><tr><td>EGRESOS POR GASTOS DEL MES</td><td class="n">${n(-egresos)}</td></tr><tr class="total"><td>SALDO AL CIERRE</td><td class="n">${n(saldoCierre)}</td></tr></table>
      <div class="subh">ESTADO PATRIMONIAL</div><table class="t"><tr><td>DISPONIBILIDADES AL CIERRE</td><td class="n">${n(saldoCierre)}</td></tr><tr><td>EXPENSAS A COBRAR POR GASTOS</td><td class="n">${n(expensasACobrar)}</td></tr><tr><td>DEUDAS E INTERESES A COBRAR</td><td class="n">${n(deudasAnteriores)}</td></tr><tr><td>PROVEEDORES A PAGAR</td><td class="n">${n(-aPagar)}</td></tr><tr class="total"><td>PATRIMONIO NETO AL CIERRE</td><td class="n">${n(round2(saldoCierre + expensasACobrar - aPagar))}</td></tr></table>`, '(Conf. Art. 10 inc c e i Ley Nº 941)')}
    ${sec('DATOS DE JUICIOS', '<p class="center mut">No hay juicios vigentes informados</p>', '(Conf. Art. 10 inc h Ley Nº 941)')}
    ${cs.length ? `<div class="sec apaisado"><div class="sec-h"><span>ESTADO DE CUENTAS Y PRORRATEO DE GASTOS</span></div><div class="sec-b">
    <table class="t chico"><thead><tr><th>UF</th><th>Depto.</th><th>Propietario</th><th class="n">Saldo<br>Anterior</th><th class="n">Pagos<br>Recibidos</th><th class="n">Deuda</th><th class="n">Interés</th><th class="n">Disponible</th>${colsUsadas.map((c) => `<th class="n">% ${c.key.toUpperCase()}</th><th class="n">${c.titulo}</th>`).join('')}<th class="n">Redon.</th><th class="n">TOTAL</th><th class="n">2do vto</th></tr></thead>
    <tbody>${filasCupon}<tr class="total"><td colspan="3">TOTALES</td><td></td><td class="n">${n(Object.values(pagosPorUnidad).reduce((s, v) => s + v, 0))}</td><td class="n">${n(deudasAnteriores)}</td><td class="n">${n(totCup('intereses'))}</td><td></td>${colsUsadas.map((c) => `<td class="n">100,00%</td><td class="n">${n(totCup(`monto_${c.key}` as keyof Cupon))}</td>`).join('')}<td></td><td class="n">${n(totCup('total'))}</td><td class="n">${n(totCup('total_2do_venc'))}</td></tr></tbody></table></div></div>` : '<p class="mut">Todavía no hay cupones generados: usá "Simular" para ver el prorrateo.</p>'}
    ${liq.notas ? sec('NOTAS', `<div class="notas">${escHtml(liq.notas)}</div>`) : ''}
    ${fp.length ? `<div class="sec"><div class="sec-b"><div class="fp-h">FORMAS DE PAGO</div>${fp.map((x) => `<div>${x}</div>`).join('')}</div></div>` : ''}
    <p class="chico mut center" style="margin-top:14px">${escHtml(a?.nombre || '')}${a?.rpa ? ` · R.P.A. ${escHtml(a.rpa)}` : ''} · Liquidación emitida el ${fmtDate(new Date().toISOString().slice(0, 10))}</p>`;
  imprimirHtml(`${consorcio.nombre} - Expensas ${liq.periodo}`, html, `
    :root { --teal: #13a39a; }
    body { font-size: 10.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1, h2, h3 { display: none; }
    .center { text-align: center; }
    .sec { border: 1px solid #94a3b8; border-radius: 3px; margin: 0 0 10px; page-break-inside: avoid; }
    .sec-h { background: var(--teal); color: #fff; font-weight: bold; text-align: center; padding: 5px 8px; font-size: 11px; position: relative; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sec-h.big { font-size: 12px; line-height: 1.5; }
    .sec-h .ref { position: absolute; left: 8px; top: 5px; font-size: 9px; font-weight: bold; }
    .sec-b { padding: 8px 10px; }
    .cols3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 10px; line-height: 1.5; }
    .cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .qrrow { display: flex; gap: 10px; align-items: flex-start; } .qrrow img { width: 90px; height: 90px; flex-shrink: 0; }
    table.t { width: 100%; border-collapse: collapse; margin: 0; }
    table.t th { background: #e2e8f0; color: #1e293b; font-size: 9.5px; text-transform: none; border: 1px solid #94a3b8; padding: 3px 5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.t td { border: 1px solid #cbd5e1; padding: 3px 5px; font-size: 10px; }
    table.t.chico td, table.t.chico th { font-size: 8.5px; padding: 2px 3px; white-space: nowrap; }
    tr.rubro td { background: #f1f5f9; font-weight: bold; font-size: 10px; border-top: 2px solid #94a3b8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr.sub td { font-weight: bold; background: #f8fafc; } tr.total td { font-weight: bold; background: #e2e8f0; border-top: 2px solid #475569; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .subh { text-align: center; font-weight: bold; font-size: 10px; margin: 8px 0 4px; }
    .notas { white-space: pre-wrap; line-height: 1.5; font-size: 10.5px; }
    .fp-h { color: var(--teal); font-weight: bold; margin-bottom: 4px; }
    .emp { border: 1px solid #cbd5e1; border-radius: 3px; padding: 6px 8px; margin-bottom: 8px; page-break-inside: avoid; }
    .emp table.t td { border: 0; border-bottom: 1px dotted #e2e8f0; padding: 2px 4px; }
    .apaisado { page: apaisada; page-break-before: always; }
    @page { size: A4; margin: 0; } @page apaisada { size: A4 landscape; margin: 0; }
    body { padding: 12mm 10mm; } @media print { body { padding: 12mm 10mm; } }`);
}

/*
  Motor de negocio: liquidación de expensas, cuenta corriente, cobranza y sueldos.

  Reglas implementadas:
  - Prorrateo: cada gasto tiene categoría A/B/C/D; el total de cada categoría se distribuye
    entre las UF según su coeficiente (%) de esa categoría.
  - Saldo anterior: deuda (o saldo a favor) de la UF al momento de liquidar
    = Σ cupones anteriores − Σ pagos registrados.
  - Intereses de mora: % mensual (config. del consorcio) sobre el saldo vencido positivo.
  - 2º vencimiento: total × (1 + recargo%) sólo sobre los gastos del período (el saldo
    anterior ya trae su interés).
  - Estado del cupón: pagado si lo cobrado cubre el total (con tolerancia $1), parcial si hay
    cobros menores, pendiente si no hay cobros.
*/

import { supabase, type Consorcio, type Cupon, type Gasto, type Unidad, type Empleado, type Parametro, type Proveedor, type ReciboLinea } from './supabase';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const fmtMoney = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n || 0);

export const fmtMoney0 = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0);

export const fmtPct = (n: number) => `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n)} %`;

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};

export const hoyISO = () => new Date().toISOString().slice(0, 10);

export const periodoActual = () => new Date().toISOString().slice(0, 7); // YYYY-MM

export const periodoLabel = (p: string) => {
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const [y, m] = p.split('-').map(Number);
  return `${meses[(m || 1) - 1]} ${y}`;
};

export const periodoSiguiente = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m, 1); // mes siguiente (m es 1-based → index m = mes+1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const CATEGORIAS: { key: 'A' | 'B' | 'C' | 'D'; label: string; coef: 'coef_a' | 'coef_b' | 'coef_c' | 'coef_d' }[] = [
  { key: 'A', label: 'A · Expensas ordinarias', coef: 'coef_a' },
  { key: 'B', label: 'B · Cocheras', coef: 'coef_b' },
  { key: 'C', label: 'C · Cuota extraordinaria', coef: 'coef_c' },
  { key: 'D', label: 'D · Gastos particulares', coef: 'coef_d' },
];

// ==================== Cuenta corriente ====================

export type SaldoUnidad = {
  unidad_id: string;
  totalCupones: number;   // deuda generada (cupones de liquidaciones cerradas/enviadas)
  totalPagado: number;
  saldo: number;          // >0 deuda, <0 a favor
};

/** Saldos de todas las UF de un consorcio, opcionalmente excluyendo una liquidación (la que se está generando). */
export async function saldosPorUnidad(consorcioId: string, excluirLiquidacionId?: string): Promise<Map<string, SaldoUnidad>> {
  const [cuponesRes, pagosRes] = await Promise.all([
    supabase.from('cupones').select('unidad_id, total, liquidacion_id, liquidaciones!inner(estado)').eq('consorcio_id', consorcioId),
    supabase.from('pagos').select('unidad_id, monto').eq('consorcio_id', consorcioId),
  ]);
  const map = new Map<string, SaldoUnidad>();
  const get = (id: string) => {
    let s = map.get(id);
    if (!s) { s = { unidad_id: id, totalCupones: 0, totalPagado: 0, saldo: 0 }; map.set(id, s); }
    return s;
  };
  for (const c of (cuponesRes.data || []) as unknown as { unidad_id: string; total: number; liquidacion_id: string; liquidaciones: { estado: string } }[]) {
    if (excluirLiquidacionId && c.liquidacion_id === excluirLiquidacionId) continue;
    if (c.liquidaciones.estado === 'abierta') continue; // sólo liquidaciones cerradas generan deuda exigible
    get(c.unidad_id).totalCupones += Number(c.total);
  }
  for (const p of (pagosRes.data || []) as { unidad_id: string; monto: number }[]) {
    get(p.unidad_id).totalPagado += Number(p.monto);
  }
  for (const s of map.values()) s.saldo = round2(s.totalCupones - s.totalPagado);
  return map;
}

// ==================== Liquidación ====================

export type ResultadoLiquidacion = {
  cupones: number;
  totalGastos: number;
  totalDistribuido: number;
  advertencias: string[];
};

/** Valida que los coeficientes de una categoría sumen ~100 (si hay gastos en esa categoría). */
export function validarCoeficientes(unidades: Unidad[], gastos: Gasto[]): string[] {
  const adv: string[] = [];
  for (const cat of CATEGORIAS) {
    const totalCat = gastos.reduce((a, g) => a + Number(g[`monto_${cat.key.toLowerCase()}` as 'monto_a']), 0);
    if (totalCat <= 0) continue;
    const sumCoef = unidades.filter((u) => u.activo).reduce((a, u) => a + Number(u[cat.coef]), 0);
    if (Math.abs(sumCoef - 100) > 0.05) {
      adv.push(`Los coeficientes de la categoría ${cat.key} suman ${sumCoef.toFixed(2)}% (deberían sumar 100%). La distribución quedará desbalanceada.`);
    }
  }
  return adv;
}

/**
 * Genera (o regenera) los cupones de una liquidación ABIERTA:
 * prorratea los gastos vinculados por categoría, arrastra saldo anterior y calcula intereses.
 */
export async function generarCupones(liquidacionId: string): Promise<ResultadoLiquidacion> {
  const { data: liq, error: liqErr } = await supabase
    .from('liquidaciones').select('*, consorcios(*)').eq('id', liquidacionId).single();
  if (liqErr || !liq) throw new Error('No se encontró la liquidación.');
  if (liq.estado !== 'abierta') throw new Error('Sólo se pueden generar cupones de una liquidación abierta. Reabrila primero.');

  const consorcio = liq.consorcios as Consorcio;
  const [{ data: unidades }, { data: gastos }] = await Promise.all([
    supabase.from('unidades').select('*').eq('consorcio_id', liq.consorcio_id).eq('activo', true).order('uf'),
    supabase.from('gastos').select('*').eq('liquidacion_id', liquidacionId),
  ]);
  if (!unidades || unidades.length === 0) throw new Error('El consorcio no tiene unidades activas cargadas.');

  const gs = (gastos || []) as Gasto[];
  const us = unidades as Unidad[];
  const advertencias = validarCoeficientes(us, gs);

  const totalPorCat: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const g of gs) { totalPorCat.A += Number(g.monto_a); totalPorCat.B += Number(g.monto_b); totalPorCat.C += Number(g.monto_c); totalPorCat.D += Number(g.monto_d); }
  const totalGastos = round2(totalPorCat.A + totalPorCat.B + totalPorCat.C + totalPorCat.D);

  const recargoPct = Number(consorcio.recargo_2do_venc_pct) || 0;
  const interesPct = Number(consorcio.interes_mora_mensual_pct) || 0;
  const saldos = await saldosPorUnidad(liq.consorcio_id, liquidacionId);

  const filas = us.map((u) => {
    const monto_a = round2(totalPorCat.A * Number(u.coef_a) / 100);
    const monto_b = round2(totalPorCat.B * Number(u.coef_b) / 100);
    const monto_c = round2(totalPorCat.C * Number(u.coef_c) / 100);
    const monto_d = round2(totalPorCat.D * Number(u.coef_d) / 100);
    const saldo_anterior = round2(saldos.get(u.id)?.saldo || 0);
    const intereses = saldo_anterior > 0 ? round2(saldo_anterior * interesPct / 100) : 0;
    const gastosPeriodo = round2(monto_a + monto_b + monto_c + monto_d);
    const total = round2(gastosPeriodo + saldo_anterior + intereses);
    const total_2do_venc = round2(gastosPeriodo * (1 + recargoPct / 100) + saldo_anterior + intereses);
    return {
      liquidacion_id: liquidacionId, consorcio_id: liq.consorcio_id, unidad_id: u.id,
      monto_a, monto_b, monto_c, monto_d, saldo_anterior, intereses, total, total_2do_venc,
      estado: 'pendiente' as const,
    };
  });

  // Regenerar: borrar cupones previos de esta liquidación e insertar los nuevos
  const { error: delErr } = await supabase.from('cupones').delete().eq('liquidacion_id', liquidacionId);
  if (delErr) throw new Error(`No se pudieron limpiar los cupones anteriores: ${delErr.message}`);
  const { error: insErr } = await supabase.from('cupones').insert(filas);
  if (insErr) throw new Error(`No se pudieron generar los cupones: ${insErr.message}`);

  const totalDistribuido = round2(filas.reduce((a, f) => a + f.total, 0));
  const { error: updErr } = await supabase.from('liquidaciones').update({
    total_gastos: totalGastos,
    total_distribuido: totalDistribuido,
    recargo_2do_venc_pct: recargoPct,
    interes_mora_pct: interesPct,
  }).eq('id', liquidacionId);
  if (updErr) throw new Error(updErr.message);

  return { cupones: filas.length, totalGastos, totalDistribuido, advertencias };
}

/** Cierra una liquidación (genera cupones si faltan y congela el período). */
export async function cerrarLiquidacion(liquidacionId: string, usuario: string): Promise<ResultadoLiquidacion> {
  const res = await generarCupones(liquidacionId);
  const { error } = await supabase.from('liquidaciones').update({
    estado: 'cerrada', cerrada_por: usuario, cerrada_at: new Date().toISOString(),
  }).eq('id', liquidacionId);
  if (error) throw new Error(error.message);
  return res;
}

/** Reabre una liquidación cerrada (si no está enviada o si se confirma). Los cupones se regeneran al volver a cerrar. */
export async function reabrirLiquidacion(liquidacionId: string) {
  const { count } = await supabase.from('pagos').select('id', { count: 'exact', head: true })
    .in('cupon_id', (await supabase.from('cupones').select('id').eq('liquidacion_id', liquidacionId)).data?.map((c) => c.id) || ['00000000-0000-0000-0000-000000000000']);
  const { error } = await supabase.from('liquidaciones').update({ estado: 'abierta', enviada_at: null }).eq('id', liquidacionId);
  if (error) throw new Error(error.message);
  return { pagosImputados: count || 0 };
}

// ==================== Cobranza ====================

export type MontoEsperado = { monto: number; vencimiento: '1ro' | '2do' | 'vencido' };

/** Cuánto corresponde cobrar hoy por un cupón según la fecha (1º o 2º vencimiento). */
export function montoEsperado(cupon: Cupon, fv1: string | null, fv2: string | null, hoy = hoyISO()): MontoEsperado {
  if (fv1 && hoy <= fv1) return { monto: cupon.total, vencimiento: '1ro' };
  if (fv2 && hoy <= fv2) return { monto: cupon.total_2do_venc, vencimiento: '2do' };
  return { monto: cupon.total_2do_venc, vencimiento: 'vencido' };
}

/** Cuenta predeterminada del consorcio (si no hay, la primera activa). Ahí caen los cobros/pagos sin cuenta indicada. */
export async function cuentaPredeterminada(consorcioId: string): Promise<string | null> {
  const { data } = await supabase.from('cuentas').select('id, predeterminada').eq('consorcio_id', consorcioId).eq('activa', true)
    .order('predeterminada', { ascending: false }).order('created_at').limit(1);
  return data?.[0]?.id ?? null;
}

/** Registra un pago, actualiza el estado del cupón y genera el movimiento de caja (ingreso). */
export async function registrarPago(params: {
  consorcio_id: string; unidad_id: string; cupon_id: string | null;
  fecha: string; monto: number; metodo: string; comprobante?: string; observaciones?: string;
  cuenta_id?: string | null; registrado_por?: string;
}) {
  const { cuenta_id, ...pago } = params;
  const { data: inserted, error } = await supabase.from('pagos').insert({
    ...pago, comprobante: pago.comprobante || null, observaciones: pago.observaciones || null,
    registrado_por: pago.registrado_por || null,
  }).select().single();
  if (error) throw new Error(error.message);

  if (params.cupon_id) await actualizarEstadoCupon(params.cupon_id);

  // Movimiento de caja automático
  const { data: unidad } = await supabase.from('unidades').select('uf, depto').eq('id', params.unidad_id).single();
  await supabase.from('movimientos').insert({
    consorcio_id: params.consorcio_id, cuenta_id: cuenta_id || await cuentaPredeterminada(params.consorcio_id), fecha: params.fecha,
    tipo: 'ingreso', concepto: `Cobranza expensas UF ${unidad?.uf ?? ''} ${unidad?.depto ?? ''}`.trim(),
    monto: params.monto, origen: 'pago', origen_id: inserted.id,
  });
  return inserted;
}

export async function eliminarPago(pagoId: string) {
  const { data: pago } = await supabase.from('pagos').select('cupon_id').eq('id', pagoId).single();
  await supabase.from('movimientos').delete().eq('origen', 'pago').eq('origen_id', pagoId);
  const { error } = await supabase.from('pagos').delete().eq('id', pagoId);
  if (error) throw new Error(error.message);
  if (pago?.cupon_id) await actualizarEstadoCupon(pago.cupon_id);
}

export async function actualizarEstadoCupon(cuponId: string) {
  const [{ data: cupon }, { data: pagos }] = await Promise.all([
    supabase.from('cupones').select('total').eq('id', cuponId).single(),
    supabase.from('pagos').select('monto').eq('cupon_id', cuponId),
  ]);
  if (!cupon) return;
  const cobrado = (pagos || []).reduce((a, p) => a + Number(p.monto), 0);
  const estado = cobrado <= 0 ? 'pendiente' : cobrado + 1 >= Number(cupon.total) ? 'pagado' : 'parcial';
  await supabase.from('cupones').update({ estado }).eq('id', cuponId);
}

// ==================== Órdenes de pago ====================

/** Marca una OP como pagada: marca los gastos vinculados como pagados y genera el egreso en caja. */
export async function pagarOrdenPago(opId: string, cuentaId: string | null, retenciones: RetencionPropuesta[] = [], fecha = hoyISO()) {
  const { data: op, error } = await supabase.from('ordenes_pago').select('*, proveedores(nombre)').eq('id', opId).single();
  if (error || !op) throw new Error('No se encontró la orden de pago.');
  if (op.estado === 'pagada') throw new Error('La orden ya está pagada.');
  const totalRet = round2(retenciones.reduce((a, r) => a + r.monto, 0));
  const neto = round2(Number(op.monto) - totalRet);
  const nombreProv = (op.proveedores as { nombre?: string } | null)?.nombre || 'Proveedor';
  await supabase.from('gastos').update({ pagado: true, fecha_pago: fecha }).eq('orden_pago_id', opId);
  // Egreso de caja por el neto (lo retenido sale cuando se deposita la retención)
  await supabase.from('movimientos').insert({
    consorcio_id: op.consorcio_id, cuenta_id: cuentaId || await cuentaPredeterminada(op.consorcio_id), fecha, tipo: 'egreso',
    concepto: `OP #${op.numero} — ${nombreProv}${totalRet ? ` (neto de retenciones ${fmtMoney(totalRet)})` : ''}`,
    monto: neto, origen: 'orden_pago', origen_id: op.id,
  });
  if (retenciones.length) {
    const { error: rErr } = await supabase.from('retenciones').insert(retenciones.map((r) => ({
      consorcio_id: op.consorcio_id, proveedor_id: op.proveedor_id, orden_pago_id: op.id, tipo: r.tipo,
      base: r.base, alicuota: r.alicuota, monto: r.monto, fecha, estado: 'pendiente',
    })));
    if (rErr) throw new Error(`Retenciones: ${rErr.message}`);
  }
  const { error: updErr } = await supabase.from('ordenes_pago').update({ estado: 'pagada', retenciones_total: totalRet, neto_pagado: neto, fecha_pago: fecha }).eq('id', opId);
  if (updErr) throw new Error(updErr.message);
}

// ==================== Parámetros ====================

export type Params = Record<string, number>;
let _params: Params | null = null;
/** Parámetros (aportes, contribuciones, convenio, retenciones) de la tabla `parametros`. Se cachean por sesión. */
export async function cargarParametros(force = false): Promise<Params> {
  if (_params && !force) return _params;
  const { data } = await supabase.from('parametros').select('*');
  _params = {};
  for (const p of (data as Parametro[]) || []) _params[p.clave] = Number(p.valor);
  return _params;
}
export const invalidarParametros = () => { _params = null; };
const P = (p: Params, k: string, def = 0) => (k in p ? p[k] : def);

// ==================== Sueldos ====================

export const aniosAntiguedad = (fechaIngreso: string | null, hasta = hoyISO()) =>
  fechaIngreso ? Math.max(0, Math.floor((new Date(hasta).getTime() - new Date(fechaIngreso).getTime()) / (365.25 * 24 * 3600 * 1000))) : 0;

/** Días de vacaciones por antigüedad (LCT art. 150): 14 / 21 / 28 / 35. */
export const diasVacaciones = (anios: number) => (anios < 5 ? 14 : anios < 10 ? 21 : anios < 20 ? 28 : 35);

export type NovedadesSueldo = {
  basico?: number;          // si viene, pisa el del empleado/escala
  adicionales?: number;     // adicionales remunerativos manuales
  no_remunerativo?: number;
  horas_50?: number; horas_100?: number;
  sac?: boolean | number;   // true = calcular (50% de la mejor remuneración = la de este mes), número = monto fijo
  dias_vacaciones?: number; // plus vacacional por esos días
  descuentos?: number;      // otros descuentos (adelantos, embargos)
  periodo?: string;         // YYYY-MM (para la antigüedad al cierre)
};

/**
 * Recibo completo según parámetros:
 *  remunerativo = básico + antigüedad + adicionales de convenio + adicionales manuales + horas extras + SAC + plus vacacional
 *  aportes      = remunerativo × Σ aportes (jubilación, PAMI, obra social, sindicato, FATERYH)
 *  neto         = remunerativo − aportes + no remunerativo − otros descuentos
 *  contribuciones = remunerativo × Σ contribuciones + ART fijo + seguro de vida
 *  costo total  = remunerativo + no remunerativo + contribuciones
 */
export function calcularSueldoCompleto(e: Empleado, p: Params, n: NovedadesSueldo = {}, basicoEscala?: number) {
  const hasta = n.periodo ? `${n.periodo}-28` : hoyISO();
  const basico = round2(n.basico ?? (e.usar_escala && basicoEscala ? basicoEscala : Number(e.sueldo_basico) || 0));
  const anios = aniosAntiguedad(e.antiguedad_fecha, hasta);
  const antiguedad = round2(basico * (P(p, 'cv_antiguedad_pct', 1) / 100) * anios);
  const lineas: ReciboLinea[] = [
    { concepto: 'Sueldo básico', tipo: 'rem', monto: basico, detalle: e.categoria || undefined },
  ];
  if (antiguedad) lineas.push({ concepto: 'Antigüedad', tipo: 'rem', monto: antiguedad, detalle: `${anios} año${anios === 1 ? '' : 's'} × ${P(p, 'cv_antiguedad_pct', 1)}%` });
  let adicConvenio = 0;
  const adic: [boolean, string, string][] = [[e.adic_titulo, 'cv_adic_titulo', 'Adicional título'], [e.adic_vidrios, 'cv_adic_vidrios', 'Limpieza de vidrios'], [e.adic_residuos, 'cv_adic_residuos', 'Retiro de residuos'], [e.adic_jardin, 'cv_adic_jardin', 'Jardín']];
  for (const [flag, clave, nombre] of adic) if (flag && P(p, clave)) { adicConvenio = round2(adicConvenio + P(p, clave)); lineas.push({ concepto: nombre, tipo: 'rem', monto: round2(P(p, clave)) }); }
  const adicionales = round2(n.adicionales || 0);
  if (adicionales) lineas.push({ concepto: 'Adicionales', tipo: 'rem', monto: adicionales });
  const valorHora = (basico + antiguedad) / (P(p, 'cv_horas_mes', 200) || 200);
  const h50 = Number(n.horas_50 || 0), h100 = Number(n.horas_100 || 0);
  const horasExtras = round2(valorHora * 1.5 * h50 + valorHora * 2 * h100);
  if (h50) lineas.push({ concepto: 'Horas extras 50%', tipo: 'rem', monto: round2(valorHora * 1.5 * h50), detalle: `${h50} hs × ${fmtMoney(round2(valorHora * 1.5))}` });
  if (h100) lineas.push({ concepto: 'Horas extras 100%', tipo: 'rem', monto: round2(valorHora * 2 * h100), detalle: `${h100} hs × ${fmtMoney(round2(valorHora * 2))}` });
  const baseMensual = round2(basico + antiguedad + adicConvenio + adicionales + horasExtras);
  const diasVac = Number(n.dias_vacaciones || 0);
  const vacaciones = diasVac ? round2((baseMensual / 25 - baseMensual / 30) * diasVac) : 0;
  if (vacaciones) lineas.push({ concepto: 'Plus vacacional', tipo: 'rem', monto: vacaciones, detalle: `${diasVac} días` });
  const sac = typeof n.sac === 'number' ? round2(n.sac) : n.sac ? round2(baseMensual / 2) : 0;
  if (sac) lineas.push({ concepto: 'SAC (aguinaldo)', tipo: 'rem', monto: sac, detalle: typeof n.sac === 'number' ? undefined : '50% de la remuneración del mes' });
  const bruto = round2(baseMensual + vacaciones + sac);

  const apClaves: [string, string][] = [['ap_jubilacion', 'Jubilación'], ['ap_ley19032', 'Ley 19.032'], ['ap_obra_social', 'Obra social'], ['ap_sindicato', 'Cuota sindical'], ['ap_fateryh', 'FATERYH']];
  let aportes = 0;
  for (const [k, nombre] of apClaves) { const m = round2(bruto * P(p, k) / 100); if (m) { aportes = round2(aportes + m); lineas.push({ concepto: nombre, tipo: 'desc', monto: m, detalle: `${P(p, k)}%` }); } }
  const noRem = round2(n.no_remunerativo || 0) + (!e.vive_en_edificio && P(p, 'cv_adic_vivienda') ? round2(P(p, 'cv_adic_vivienda')) : 0);
  if (n.no_remunerativo) lineas.push({ concepto: 'No remunerativo', tipo: 'norem', monto: round2(n.no_remunerativo) });
  if (!e.vive_en_edificio && P(p, 'cv_adic_vivienda')) lineas.push({ concepto: 'Valor vivienda', tipo: 'norem', monto: round2(P(p, 'cv_adic_vivienda')) });
  const descuentos = round2(n.descuentos || 0);
  if (descuentos) lineas.push({ concepto: 'Otros descuentos', tipo: 'desc', monto: descuentos });
  const neto = round2(bruto - aportes + noRem - descuentos);

  const coPct = ['co_sipa', 'co_ley19032', 'co_obra_social', 'co_fateryh', 'co_art_pct'].reduce((a, k) => a + P(p, k), 0);
  const contribuciones = round2(bruto * coPct / 100 + P(p, 'co_art_fijo') + P(p, 'co_seguro_vida'));
  const costo_total = round2(bruto + noRem + contribuciones);
  return {
    basico, antiguedad, adicionales, adic_convenio: adicConvenio, horas_50: h50, horas_100: h100, horas_extras: horasExtras,
    sac, vacaciones, dias_vacaciones: diasVac, no_remunerativo: round2(noRem), descuentos, bruto, aportes, neto, contribuciones, costo_total,
    detalle: lineas,
  };
}

/** Compatibilidad: cálculo simple con porcentajes fijos (se usa si no hay parámetros cargados). */
export function calcularSueldo(e: Empleado, adicionales = 0, noRemunerativo = 0) {
  const basico = Number(e.sueldo_basico) || 0;
  const years = aniosAntiguedad(e.antiguedad_fecha);
  const antiguedad = round2(basico * 0.01 * years);
  const bruto = round2(basico + antiguedad + adicionales);
  const aportes = round2(bruto * 0.17);
  const neto = round2(bruto - aportes + noRemunerativo);
  const contribuciones = round2(bruto * 0.264);
  const costo_total = round2(bruto + contribuciones + noRemunerativo);
  return { basico, antiguedad, adicionales: round2(adicionales), no_remunerativo: round2(noRemunerativo), bruto, aportes, neto, contribuciones, costo_total };
}

// ==================== Retenciones a proveedores ====================

export type RetencionPropuesta = { tipo: 'ganancias' | 'iibb' | 'suss'; base: number; alicuota: number; monto: number };

/**
 * Retenciones que corresponden al pagar una OP a un proveedor, según su régimen y los parámetros.
 * Base: el monto sin IVA si es responsable inscripto (monto / 1,21), si no el monto.
 * Ganancias: se retiene sobre lo que excede el mínimo no sujeto. IIBB y SUSS: sobre toda la base si supera el mínimo.
 */
export function calcularRetenciones(prov: Proveedor | null | undefined, monto: number, p: Params): RetencionPropuesta[] {
  if (!prov) return [];
  const base = round2(prov.condicion_iva === 'ri' ? monto / 1.21 : monto);
  const out: RetencionPropuesta[] = [];
  if (prov.ret_ganancias) {
    const alic = Number(prov.ret_ganancias_alic ?? P(p, 'rt_gan_alic', 2));
    const sujeto = round2(Math.max(0, base - P(p, 'rt_gan_minimo')));
    const m = round2(sujeto * alic / 100);
    if (m > 0) out.push({ tipo: 'ganancias', base: sujeto, alicuota: alic, monto: m });
  }
  if (prov.ret_iibb && base >= P(p, 'rt_iibb_minimo')) {
    const alic = Number(prov.ret_iibb_alic ?? P(p, 'rt_iibb_alic', 3));
    const m = round2(base * alic / 100);
    if (m > 0) out.push({ tipo: 'iibb', base, alicuota: alic, monto: m });
  }
  if (prov.ret_suss && base >= P(p, 'rt_suss_minimo')) {
    const alic = Number(prov.ret_suss_alic ?? P(p, 'rt_suss_alic', 2));
    const m = round2(base * alic / 100);
    if (m > 0) out.push({ tipo: 'suss', base, alicuota: alic, monto: m });
  }
  return out;
}

// ==================== Export CSV ====================

export function exportCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ==================== Notificaciones internas ====================

export async function notificar(tipo: string, titulo: string, detalle?: string) {
  await supabase.from('notificaciones').insert({ tipo, titulo, detalle: detalle || null });
}

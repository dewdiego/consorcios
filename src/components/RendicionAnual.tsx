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
        supabase.from('cupones').select('unidad_id, total, liquidaciones!inner(periodo, estado)').eq('consorcio_id', consorcio.id),
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

      // Deudores al 31/12
      const deuda: Record<string, number> = {};
      for (const c of (cup.data || []) as unknown as { unidad_id: string; total: number; liquidaciones: { periodo: string; estado: string } }[]) if (c.liquidaciones.estado !== 'abierta' && c.liquidaciones.periodo <= p2) deuda[c.unidad_id] = (deuda[c.unidad_id] || 0) + Number(c.total);
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
    const fila = (cells: (string | number)[], cls = '') => `<tr class="${cls}">${cells.map((c, i) => `<td class="${i ? 'n' : ''}">${typeof c === 'number' ? fmtMoney(c) : escHtml(c)}</td>`).join('')}</tr>`;
    const html = `<div class="cab"><div><h1>Rendición de cuentas · Ejercicio ${anio}</h1><div class="adm"><b>${escHtml(consorcio.nombre)}</b> · ${escHtml(consorcio.direccion || '')} · CUIT ${escHtml(consorcio.cuit || '—')}<br>Administración: ${escHtml(admin?.nombre || '')}${admin?.rpa ? ` · RPA N° ${escHtml(admin.rpa)}` : ''}${admin?.cuit ? ` · CUIT ${escHtml(admin.cuit)}` : ''}</div></div><div class="doc"><b>${fmtDate(new Date().toISOString().slice(0, 10))}</b>Período 01/01/${anio} – 31/12/${anio}</div></div>
      <div class="grid2"><div class="caja"><span class="mut">Gastos liquidados en el año</span><br><b style="font-size:16px">${fmtMoney(tot('gastos'))}</b></div><div class="caja"><span class="mut">Expensas cobradas en el año</span><br><b style="font-size:16px">${fmtMoney(tot('cobrado'))}</b></div><div class="caja"><span class="mut">Disponible en caja y bancos al 31/12</span><br><b style="font-size:16px">${fmtMoney(dispFinal)}</b></div><div class="caja"><span class="mut">Deuda de unidades al 31/12</span><br><b style="font-size:16px">${fmtMoney(totalDeuda)}</b> <span class="chico mut">(${deudores.length} unidades)</span></div></div>
      <h2>Resumen mensual</h2><table><thead><tr><th>Mes</th><th class="n">Gastos liquidados</th><th class="n">Expensas emitidas</th><th class="n">Cobrado</th><th class="n">Pagado a proveedores</th><th class="n">Sueldos y cargas</th></tr></thead><tbody>${meses.map((m) => fila([m.mes, m.gastos, m.emitido, m.cobrado, m.pagado, m.sueldos])).join('')}${fila(['Total', tot('gastos'), tot('emitido'), tot('cobrado'), tot('pagado'), tot('sueldos')], 'total')}</tbody></table>
      <h2>Gastos por rubro</h2><table><thead><tr><th>Rubro</th><th class="n">Comprobantes</th><th class="n">Importe</th><th class="n">% del total</th></tr></thead><tbody>${rubros.map((r) => `<tr><td>${escHtml(r.rubro)}</td><td class="n">${r.cant}</td><td class="n">${fmtMoney(r.monto)}</td><td class="n">${tot('gastos') ? (r.monto / tot('gastos') * 100).toFixed(1) : '0'}%</td></tr>`).join('')}<tr class="total"><td>Total</td><td class="n">${rubros.reduce((a, r) => a + r.cant, 0)}</td><td class="n">${fmtMoney(round2(rubros.reduce((a, r) => a + r.monto, 0)))}</td><td class="n">100%</td></tr></tbody></table>
      <h2>Caja y bancos</h2><table><thead><tr><th>Cuenta</th><th class="n">Saldo al 1/1</th><th class="n">Ingresos</th><th class="n">Egresos</th><th class="n">Saldo al 31/12</th></tr></thead><tbody>${cuentasRes.map((c) => fila([c.nombre, c.inicial, c.ing, c.egr, c.final])).join('')}${fila(['Total', round2(cuentasRes.reduce((a, c) => a + c.inicial, 0)), round2(cuentasRes.reduce((a, c) => a + c.ing, 0)), round2(cuentasRes.reduce((a, c) => a + c.egr, 0)), dispFinal], 'total')}</tbody></table>
      ${retenciones.length ? `<h2>Retenciones practicadas</h2><table><tbody>${retenciones.map((r) => fila([r.tipo.toUpperCase(), r.monto])).join('')}</tbody></table>` : ''}
      <h2>Deudores al 31/12/${anio}</h2>${deudores.length ? `<table><thead><tr><th>UF</th><th>Depto</th><th>Propietario</th><th class="n">Saldo deudor</th></tr></thead><tbody>${deudores.map((d) => `<tr><td>${d.uf}</td><td>${escHtml(d.depto)}</td><td>${escHtml(d.propietario)}</td><td class="n">${fmtMoney(d.saldo)}</td></tr>`).join('')}<tr class="total"><td colspan="3">Total</td><td class="n">${fmtMoney(totalDeuda)}</td></tr></tbody></table>` : '<p class="mut">No hay unidades con deuda.</p>'}${aFavor ? `<p class="chico mut">Saldos a favor de unidades: ${fmtMoney(aFavor)}.</p>` : ''}
      <div class="firma"><div>${escHtml(admin?.nombre || 'Administración')}<br><span class="chico">Administrador/a</span></div><div>Consejo de propietarios<br><span class="chico">Conformidad</span></div></div>`;
    imprimirHtml(`Rendición ${consorcio.nombre} ${anio}`, html);
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

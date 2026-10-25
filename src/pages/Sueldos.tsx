import { useEffect, useState } from 'react';
import { Calculator, Download, FileText, Plus, Pencil, Printer, Receipt, Save, Trash2, Users, WalletCards } from 'lucide-react';
import { supabase, type Administracion, type ConvenioEscala, type Empleado, type Parametro, type ReciboLinea, type Rubro, type SueldoLiquidacion } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { aniosAntiguedad, calcularSueldoCompleto, cargarParametros, cuentaPredeterminada, diasVacaciones, exportCSV, fmtDate, fmtMoney, hoyISO, invalidarParametros, periodoActual, periodoLabel, round2, type NovedadesSueldo, type Params } from '@/lib/engine';
import { escHtml, imprimirHtml } from '@/lib/imprimir';
import { Ayuda } from '@/components/Ayuda';

/*
  Sueldos del personal del consorcio (CCT 589/10 SUTERH, parametrizable):
  - Empleados: datos del legajo, categoría del convenio, adicionales fijos (título, vidrios, residuos, jardín).
  - Escala: básicos por categoría con vigencia (se actualiza en cada paritaria).
  - Parámetros: % de aportes, contribuciones, antigüedad, valores de adicionales.
  - Liquidación mensual: preliquidar → cargar novedades (horas extras, SAC, vacaciones, descuentos) → confirmar → recibo → pagar.
  - Para el contador: resumen de aportes/contribuciones (F.931) y exportación del período.
*/

const cargos = ['encargado', 'ayudante', 'suplente', 'personal_limpieza', 'vigilancia', 'otro'];
const empVacio = { nombre: '', cuil: '', cargo: 'encargado', categoria: '', usar_escala: false, sueldo_basico: '', antiguedad_fecha: '', fecha_egreso: '', vive_en_edificio: false, jornada: 'completa', obra_social: '', cbu: '', adic_titulo: false, adic_vidrios: false, adic_residuos: false, adic_jardin: false, activo: true };
type NovForm = { basico: string; adicionales: string; no_remunerativo: string; horas_50: string; horas_100: string; sac: boolean; sac_monto: string; dias_vacaciones: string; descuentos: string; observaciones: string };

export function Sueldos() {
  const { consorcio } = useApp();
  const [tab, setTab] = useState('liquidaciones');
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [liqs, setLiqs] = useState<SueldoLiquidacion[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [escalas, setEscalas] = useState<ConvenioEscala[]>([]);
  const [parametros, setParametros] = useState<Parametro[]>([]);
  const [params, setParams] = useState<Params>({});
  const [admin, setAdmin] = useState<Administracion | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState(periodoActual());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [empModal, setEmpModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Empleado | null>(null);
  const [empForm, setEmpForm] = useState({ ...empVacio });
  const [deleteEmp, setDeleteEmp] = useState<Empleado | null>(null);
  const [novModal, setNovModal] = useState<SueldoLiquidacion | null>(null);
  const [nov, setNov] = useState<NovForm | null>(null);
  const [escForm, setEscForm] = useState({ categoria: '', basico: '', vigencia_desde: hoyISO(), notas: '' });
  const [paramEdit, setParamEdit] = useState<Record<string, string>>({});
  const [pagarTarget, setPagarTarget] = useState<SueldoLiquidacion | null>(null);
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [borrarLiq, setBorrarLiq] = useState<SueldoLiquidacion | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [e, l, r, es, pa, ad, pp] = await Promise.all([
      supabase.from('empleados').select('*').eq('consorcio_id', consorcio.id).order('nombre'),
      supabase.from('sueldo_liquidaciones').select('*, empleados(*)').eq('consorcio_id', consorcio.id).order('periodo', { ascending: false }),
      supabase.from('rubros').select('*').order('orden'),
      supabase.from('convenio_escalas').select('*').order('categoria').order('vigencia_desde', { ascending: false }),
      supabase.from('parametros').select('*').in('grupo', ['aportes', 'contribuciones', 'convenio']).order('grupo').order('orden'),
      supabase.from('administracion').select('*').limit(1).maybeSingle(),
      cargarParametros(true),
    ]);
    setEmpleados((e.data as Empleado[]) || []);
    setLiqs((l.data as SueldoLiquidacion[]) || []);
    setRubros((r.data as Rubro[]) || []);
    setEscalas((es.data as ConvenioEscala[]) || []);
    setParametros((pa.data as Parametro[]) || []);
    setParamEdit(Object.fromEntries(((pa.data as Parametro[]) || []).map((p) => [p.clave, String(p.valor)])));
    setAdmin(ad.data as Administracion | null);
    setParams(pp);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg('');
    try { const t = await fn(); if (t) setMsg(t); } catch (e) { setMsg(`Error: ${(e as Error).message}`); }
    setBusy(false); load();
  };

  /** Básico de escala vigente para la categoría del empleado al período. */
  const basicoEscala = (e: Empleado, per = periodo) =>
    escalas.filter((x) => x.categoria === e.categoria && x.vigencia_desde <= `${per}-28`).sort((a, b) => b.vigencia_desde.localeCompare(a.vigencia_desde))[0]?.basico;

  const esMesSac = (per: string) => ['06', '12'].includes(per.slice(5, 7));

  const preliquidar = () => run(async () => {
    if (!consorcio) return;
    const activos = empleados.filter((e) => e.activo);
    if (activos.length === 0) throw new Error('No hay empleados activos cargados.');
    let n = 0;
    for (const e of activos) {
      if (liqs.some((l) => l.empleado_id === e.id && l.periodo === periodo)) continue;
      if (e.usar_escala && !basicoEscala(e)) throw new Error(`${e.nombre}: no hay básico de escala para la categoría "${e.categoria}". Cargalo en la pestaña Escala.`);
      const calc = calcularSueldoCompleto(e, params, { sac: esMesSac(periodo), periodo }, basicoEscala(e) ? Number(basicoEscala(e)) : undefined);
      const { error } = await supabase.from('sueldo_liquidaciones').insert({ consorcio_id: consorcio.id, empleado_id: e.id, periodo, ...calc });
      if (error) throw new Error(error.message);
      n++;
    }
    return n > 0 ? `Se preliquidaron ${n} recibos de ${periodoLabel(periodo)}${esMesSac(periodo) ? ' (con SAC)' : ''}. Cargá las novedades de cada uno y confirmá.` : `Todos los empleados activos ya tienen liquidación en ${periodoLabel(periodo)}.`;
  });

  const abrirNovedades = (l: SueldoLiquidacion) => {
    setNov({
      basico: String(l.basico), adicionales: String(l.adicionales), no_remunerativo: String(l.no_remunerativo - (l.detalle?.find((x) => x.concepto === 'Valor vivienda')?.monto || 0)),
      horas_50: String(l.horas_50), horas_100: String(l.horas_100), sac: Number(l.sac) > 0, sac_monto: '', dias_vacaciones: String(l.dias_vacaciones),
      descuentos: String(l.descuentos), observaciones: l.observaciones || '',
    });
    setNovModal(l);
  };
  const aplicarNovedades = () => run(async () => {
    if (!novModal?.empleados || !nov) return;
    const n: NovedadesSueldo = {
      basico: parseFloat(nov.basico) || undefined, adicionales: parseFloat(nov.adicionales) || 0, no_remunerativo: parseFloat(nov.no_remunerativo) || 0,
      horas_50: parseFloat(nov.horas_50) || 0, horas_100: parseFloat(nov.horas_100) || 0,
      sac: nov.sac ? (parseFloat(nov.sac_monto) || true) : false, dias_vacaciones: parseInt(nov.dias_vacaciones) || 0,
      descuentos: parseFloat(nov.descuentos) || 0, periodo: novModal.periodo,
    };
    const calc = calcularSueldoCompleto(novModal.empleados, params, n);
    const { error } = await supabase.from('sueldo_liquidaciones').update({ ...calc, observaciones: nov.observaciones || null }).eq('id', novModal.id);
    if (error) throw new Error(error.message);
    setNovModal(null);
    return 'Recibo recalculado.';
  });

  const confirmarLiq = (l: SueldoLiquidacion) => run(async () => { await supabase.from('sueldo_liquidaciones').update({ estado: 'liquidada' }).eq('id', l.id); });
  const volverAPreliquidada = (l: SueldoLiquidacion) => run(async () => { await supabase.from('sueldo_liquidaciones').update({ estado: 'preliquidada' }).eq('id', l.id); });

  /** Pagar: egreso de caja por el neto y gasto en expensas por el costo total (bruto + cargas + no rem). */
  const pagar = () => run(async () => {
    const l = pagarTarget; if (!consorcio || !l || l.gasto_id) return;
    const rubroSueldos = rubros.find((r) => r.nombre.toLowerCase().includes('sueldo'));
    const { data: gasto, error } = await supabase.from('gastos').insert({
      consorcio_id: consorcio.id, descripcion: `Sueldo ${l.empleados?.nombre} ${periodoLabel(l.periodo)} (c/cargas sociales)`,
      rubro_id: rubroSueldos?.id || null, categoria: 'A', monto: Number(l.costo_total), fecha: fechaPago, pagado: true, fecha_pago: fechaPago,
    }).select().single();
    if (error) throw new Error(error.message);
    await supabase.from('sueldo_liquidaciones').update({ estado: 'pagada', gasto_id: gasto.id, fecha_pago: fechaPago }).eq('id', l.id);
    await supabase.from('movimientos').insert({
      consorcio_id: consorcio.id, cuenta_id: await cuentaPredeterminada(consorcio.id), fecha: fechaPago, tipo: 'egreso',
      concepto: `Sueldo ${l.empleados?.nombre} ${periodoLabel(l.periodo)}`, monto: Number(l.neto), origen: 'sueldo', origen_id: l.id,
    });
    setPagarTarget(null);
    return `Pagado: egreso de caja ${fmtMoney(Number(l.neto))} y gasto en expensas por ${fmtMoney(Number(l.costo_total))} (costo total con cargas).`;
  });

  const saveEmp = () => run(async () => {
    if (!consorcio || !empForm.nombre.trim()) throw new Error('Poné el nombre del empleado.');
    const payload = {
      consorcio_id: consorcio.id, nombre: empForm.nombre.trim(), cuil: empForm.cuil || null, cargo: empForm.cargo, categoria: empForm.categoria || null,
      usar_escala: empForm.usar_escala, sueldo_basico: parseFloat(empForm.sueldo_basico) || 0, antiguedad_fecha: empForm.antiguedad_fecha || null,
      fecha_egreso: empForm.fecha_egreso || null, vive_en_edificio: empForm.vive_en_edificio, jornada: empForm.jornada, obra_social: empForm.obra_social || null,
      cbu: empForm.cbu || null, adic_titulo: empForm.adic_titulo, adic_vidrios: empForm.adic_vidrios, adic_residuos: empForm.adic_residuos, adic_jardin: empForm.adic_jardin, activo: empForm.activo,
    };
    const { error } = editingEmp ? await supabase.from('empleados').update(payload).eq('id', editingEmp.id) : await supabase.from('empleados').insert(payload);
    if (error) throw new Error(error.message);
    setEmpModal(false);
  });

  const guardarEscala = () => run(async () => {
    if (!escForm.categoria.trim() || !escForm.basico) throw new Error('Categoría y básico son obligatorios.');
    const { error } = await supabase.from('convenio_escalas').upsert({ categoria: escForm.categoria.trim(), basico: parseFloat(escForm.basico), vigencia_desde: escForm.vigencia_desde, notas: escForm.notas || null }, { onConflict: 'categoria,vigencia_desde' });
    if (error) throw new Error(error.message);
    setEscForm({ categoria: '', basico: '', vigencia_desde: hoyISO(), notas: '' });
    return 'Escala guardada. Las próximas preliquidaciones usan este básico para esa categoría.';
  });

  const guardarParametros = () => run(async () => {
    const cambios = parametros.filter((p) => String(p.valor) !== paramEdit[p.clave]).map((p) => ({ ...p, valor: parseFloat(paramEdit[p.clave]) || 0 }));
    if (!cambios.length) return 'No hay cambios.';
    const { error } = await supabase.from('parametros').upsert(cambios);
    if (error) throw new Error(error.message);
    invalidarParametros();
    return `${cambios.length} parámetro(s) actualizado(s). Se aplican a las liquidaciones nuevas o recalculadas.`;
  });

  // ---------- Recibo ----------
  const htmlRecibo = (l: SueldoLiquidacion) => {
    const e = l.empleados!; const c = consorcio!;
    const lineas: ReciboLinea[] = l.detalle || [];
    const fila = (x: ReciboLinea) => `<tr><td>${escHtml(x.concepto)}${x.detalle ? ` <span class="mut chico">${escHtml(x.detalle)}</span>` : ''}</td><td class="n">${x.tipo === 'rem' ? fmtMoney(x.monto) : ''}</td><td class="n">${x.tipo === 'norem' ? fmtMoney(x.monto) : ''}</td><td class="n">${x.tipo === 'desc' ? fmtMoney(x.monto) : ''}</td></tr>`;
    return `<div class="cab"><div><h1>${escHtml(c.nombre)}</h1><div class="adm">CUIT ${escHtml(c.cuit || '—')} · ${escHtml(c.direccion || '')}<br>Administra: ${escHtml(admin?.nombre || '')}${admin?.rpa ? ` · RPA ${escHtml(admin.rpa)}` : ''}</div></div>
      <div class="doc"><b>RECIBO DE HABERES</b>N° ${String(l.recibo_nro).padStart(6, '0')}<br>Período: ${escHtml(periodoLabel(l.periodo))}</div></div>
      <div class="grid2 caja"><div><b>${escHtml(e.nombre)}</b><br>CUIL ${escHtml(e.cuil || '—')}</div><div>Cargo: ${escHtml(e.cargo.replace('_', ' '))}${e.categoria ? ` · ${escHtml(e.categoria)}` : ''}<br>Ingreso: ${fmtDate(e.antiguedad_fecha)} (${aniosAntiguedad(e.antiguedad_fecha, `${l.periodo}-28`)} años)</div>
      <div>Obra social: ${escHtml(e.obra_social || '—')}</div><div>Jornada: ${escHtml(e.jornada)} · ${e.vive_en_edificio ? 'Con vivienda' : 'Sin vivienda'}</div></div>
      <table><thead><tr><th>Concepto</th><th class="n">Remunerativo</th><th class="n">No remunerativo</th><th class="n">Descuentos</th></tr></thead><tbody>${lineas.map(fila).join('')}
      <tr class="total"><td>Totales</td><td class="n">${fmtMoney(Number(l.bruto))}</td><td class="n">${fmtMoney(Number(l.no_remunerativo))}</td><td class="n">${fmtMoney(round2(Number(l.aportes) + Number(l.descuentos)))}</td></tr></tbody></table>
      <div class="caja" style="display:flex;justify-content:space-between;align-items:center"><span>NETO A COBRAR</span><b style="font-size:18px">${fmtMoney(Number(l.neto))}</b></div>
      ${l.observaciones ? `<p class="chico">${escHtml(l.observaciones)}</p>` : ''}
      <p class="chico mut">Fecha de pago: ${l.fecha_pago ? fmtDate(l.fecha_pago) : '____/____/______'} · Contribuciones patronales del período: ${fmtMoney(Number(l.contribuciones))} (no se descuentan al empleado).</p>
      <div class="firma"><div>Firma del empleador</div><div>Recibí conforme · ${escHtml(e.nombre)}</div></div>`;
  };
  const imprimirRecibo = (l: SueldoLiquidacion) => imprimirHtml(`Recibo ${l.empleados?.nombre} ${l.periodo}`, htmlRecibo(l));
  const imprimirTodos = () => imprimirHtml(`Recibos ${periodo}`, liqsPeriodo.map((l) => `<div style="page-break-after:always">${htmlRecibo(l)}</div>`).join(''));

  const exportarContador = () => exportCSV(`sueldos_${consorcio?.nombre}_${periodo}.csv`,
    ['Período', 'Empleado', 'CUIL', 'Cargo', 'Categoría', 'Ingreso', 'Básico', 'Antigüedad', 'Adic. convenio', 'Adicionales', 'Hs 50%', 'Hs 100%', 'Horas extras $', 'SAC', 'Vacaciones $', 'Días vac.', 'Bruto', 'Aportes', 'No remunerativo', 'Otros desc.', 'Neto', 'Contribuciones', 'Costo total', 'Estado', 'Fecha pago'],
    liqsPeriodo.map((l) => [l.periodo, l.empleados?.nombre, l.empleados?.cuil, l.empleados?.cargo, l.empleados?.categoria, l.empleados?.antiguedad_fecha, l.basico, l.antiguedad, l.adic_convenio, l.adicionales, l.horas_50, l.horas_100, l.horas_extras, l.sac, l.vacaciones, l.dias_vacaciones, l.bruto, l.aportes, l.no_remunerativo, l.descuentos, l.neto, l.contribuciones, l.costo_total, l.estado, l.fecha_pago]));

  if (!consorcio) return null;
  const liqsPeriodo = liqs.filter((l) => l.periodo === periodo);
  const sum = (k: keyof SueldoLiquidacion) => round2(liqsPeriodo.reduce((a, l) => a + Number(l[k] || 0), 0));
  const pct = (k: string) => params[k] || 0;
  const categorias = [...new Set(escalas.map((x) => x.categoria))];

  return (
    <div>
      <PageHeader title={`Sueldos · ${consorcio.nombre}`} subtitle="Personal del edificio, liquidación mensual, recibos y resumen para el contador"
        action={tab === 'empleados'
          ? <Button onClick={() => { setEditingEmp(null); setEmpForm({ ...empVacio }); setEmpModal(true); }}><Plus size={16} /> Nuevo empleado</Button>
          : tab === 'parametros' ? <Button onClick={guardarParametros} disabled={busy}><Save size={15} /> Guardar parámetros</Button>
          : tab === 'escala' ? null
          : <div className="flex gap-2 items-end flex-wrap">
              <div className="w-40"><Input label="Período" type="month" value={periodo} onChange={setPeriodo} /></div>
              {tab === 'liquidaciones' && <Button onClick={preliquidar} disabled={busy}><Calculator size={15} /> Preliquidar</Button>}
              {liqsPeriodo.length > 0 && <Button variant="secondary" onClick={imprimirTodos}><Printer size={15} /> Recibos</Button>}
              {liqsPeriodo.length > 0 && <Button variant="secondary" onClick={exportarContador}><Download size={15} /> Para el contador</Button>}
            </div>} />

      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 mb-4 ${msg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'liquidaciones', label: 'Liquidaciones', badge: liqsPeriodo.length },
        { key: 'aportes', label: 'Aportes y contribuciones' },
        { key: 'empleados', label: 'Empleados', badge: empleados.filter((e) => e.activo).length },
        { key: 'escala', label: 'Escala convenio', badge: categorias.length || undefined },
        { key: 'parametros', label: 'Parámetros' },
      ]} />

      {tab === 'liquidaciones' && <Ayuda id="sueldos_liq" titulo="Cómo liquidar los sueldos del mes y qué hacer después">
        <ol>
          <li><b>Preliquidar</b>: arma un recibo por empleado activo con básico, antigüedad y adicionales. En junio y diciembre incluye el SAC.</li>
          <li><b>Novedades</b> (lápiz): horas extras, vacaciones, descuentos. <b>Confirmar</b> cuando esté bien.</li>
          <li><b>Recibo</b>: imprimilo por duplicado, el empleado firma uno ("recibí conforme") y se lo guarda; el otro queda en el legajo. Se paga hasta el 4º día hábil del mes siguiente.</li>
          <li><b>Pagar</b>: registra la salida de caja y mete el costo total (sueldo + cargas) como gasto de las expensas del mes.</li>
          <li><b>Después, antes del día 9 del mes siguiente</b>: presentar el F.931 en ARCA (o mandarle el CSV "Para el contador" al liquidador) y pagar aportes y contribuciones con el VEP; pagar la cuota sindical (SUTERH) y FATERYH con sus boletas. Ver pestaña "Aportes y contribuciones".</li>
        </ol>
      </Ayuda>}
      {tab === 'aportes' && <Ayuda id="sueldos_aportes" titulo="Qué se presenta y dónde con estos números">
        <ul>
          <li><b>F.931 (ARCA → Declaración en línea / Libro de Sueldos Digital)</b>: vence el día 9 del mes siguiente (o hábil siguiente). Se genera el VEP y se paga por home banking del consorcio. Incluye jubilación, PAMI, obra social, asignaciones y ART.</li>
          <li><b>SUTERH (cuota sindical) y FATERYH</b>: boletas desde los sitios del sindicato y de FATERYH, mismo vencimiento aproximado.</li>
          <li><b>Seguro de vida obligatorio</b>: lo cobra la aseguradora con la ART o aparte; cargá la póliza en el Legajo del consorcio.</li>
          <li>Si lo hace el contador, mandale el botón "Para el contador" del período: tiene todo lo que necesita.</li>
        </ul>
      </Ayuda>}
      {tab === 'empleados' && <Ayuda id="sueldos_emp" titulo="Alta y baja de personal">
        <ul>
          <li><b>Alta</b>: antes del primer día de trabajo, darlo de alta en ARCA (Simplificación Registral → Empleadores) y avisar a la ART. Después cargalo acá con fecha de ingreso, CUIL, categoría y obra social.</li>
          <li><b>Baja</b>: cargale la fecha de egreso (queda inactivo pero conserva sus recibos) y dar la baja en ARCA dentro de los 5 días. La liquidación final (vacaciones no gozadas, SAC proporcional, indemnización) conviene que la revise el liquidador.</li>
        </ul>
      </Ayuda>}
      {tab === 'escala' && <Ayuda id="sueldos_esc" titulo="Cuándo actualizar la escala">
        <p>Cada vez que sale una paritaria del convenio de encargados (CCT 589/10, SUTERH), cargá el nuevo básico de cada categoría con la fecha desde la que rige. Los recibos de períodos anteriores siguen usando la escala vieja. Si preferís no usar escala, dejá el básico en cada empleado.</p>
      </Ayuda>}
      {loading ? <Spinner /> : tab === 'liquidaciones' ? (
        liqsPeriodo.length === 0 ? (
          <Card><EmptyState icon={<WalletCards size={28} />} title={`No hay liquidaciones para ${periodoLabel(periodo)}`} subtitle='"Preliquidar" genera el recibo de cada empleado activo con básico, antigüedad y adicionales. Después cargás horas extras, SAC o vacaciones.' /></Card>
        ) : (
          <Card>
            <Table headers={['Empleado', 'Básico', 'Antig.', 'Adic.', 'Hs extras', 'SAC', 'Vac.', 'Bruto', 'Aportes', 'No rem.', 'Neto', 'Costo total', 'Estado', '']}
              footer={<tr className="bg-slate-50 font-bold"><Td>Totales</Td><Td>{fmtMoney(sum('basico'))}</Td><Td>{fmtMoney(sum('antiguedad'))}</Td><Td>{fmtMoney(round2(sum('adicionales') + sum('adic_convenio')))}</Td><Td>{fmtMoney(sum('horas_extras'))}</Td><Td>{fmtMoney(sum('sac'))}</Td><Td>{fmtMoney(sum('vacaciones'))}</Td><Td>{fmtMoney(sum('bruto'))}</Td><Td className="text-red-500">-{fmtMoney(sum('aportes'))}</Td><Td>{fmtMoney(sum('no_remunerativo'))}</Td><Td>{fmtMoney(sum('neto'))}</Td><Td>{fmtMoney(sum('costo_total'))}</Td><Td colSpan={2} /></tr>}>
              {liqsPeriodo.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{l.empleados?.nombre}<div className="text-xs text-slate-400">{l.empleados?.categoria || l.empleados?.cargo}</div></Td>
                  <Td>{fmtMoney(Number(l.basico))}</Td>
                  <Td>{fmtMoney(Number(l.antiguedad))}</Td>
                  <Td>{fmtMoney(round2(Number(l.adicionales) + Number(l.adic_convenio)))}</Td>
                  <Td>{Number(l.horas_extras) ? <>{fmtMoney(Number(l.horas_extras))}<div className="text-xs text-slate-400">{l.horas_50}h50 · {l.horas_100}h100</div></> : '—'}</Td>
                  <Td>{Number(l.sac) ? fmtMoney(Number(l.sac)) : '—'}</Td>
                  <Td>{Number(l.vacaciones) ? fmtMoney(Number(l.vacaciones)) : '—'}</Td>
                  <Td className="font-medium">{fmtMoney(Number(l.bruto))}</Td>
                  <Td className="text-red-500">-{fmtMoney(Number(l.aportes))}</Td>
                  <Td>{fmtMoney(Number(l.no_remunerativo))}</Td>
                  <Td className="font-semibold">{fmtMoney(Number(l.neto))}</Td>
                  <Td className="text-slate-500">{fmtMoney(Number(l.costo_total))}</Td>
                  <Td><Badge color={l.estado === 'pagada' ? 'green' : l.estado === 'liquidada' ? 'blue' : 'amber'}>{l.estado}</Badge>{l.fecha_pago && <div className="text-xs text-slate-400">{fmtDate(l.fecha_pago)}</div>}</Td>
                  <Td>
                    <div className="flex gap-1 items-center">
                      <button title="Recibo" onClick={() => imprimirRecibo(l)} className="p-1.5 rounded text-slate-500 hover:bg-slate-100"><FileText size={14} /></button>
                      {l.estado === 'preliquidada' && <>
                        <button title="Novedades" onClick={() => abrirNovedades(l)} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                        <Button size="sm" variant="secondary" onClick={() => confirmarLiq(l)}>Confirmar</Button>
                      </>}
                      {l.estado === 'liquidada' && <>
                        <Button size="sm" onClick={() => { setFechaPago(hoyISO()); setPagarTarget(l); }}><Receipt size={13} /> Pagar</Button>
                        <button title="Volver a editar" onClick={() => volverAPreliquidada(l)} className="text-xs text-slate-400 underline">editar</button>
                      </>}
                      {l.estado !== 'pagada' && <button onClick={() => setBorrarLiq(l)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )
      ) : tab === 'aportes' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Card className="p-5"><p className="text-xs text-slate-400">Aportes retenidos al personal · {periodoLabel(periodo)}</p><p className="text-xl font-bold text-slate-800">{fmtMoney(sum('aportes'))}</p><p className="text-xs text-slate-400 mt-1">Jubilación {pct('ap_jubilacion')}% · PAMI {pct('ap_ley19032')}% · O. social {pct('ap_obra_social')}% · Sindicato {pct('ap_sindicato')}% · FATERYH {pct('ap_fateryh')}%</p></Card>
            <Card className="p-5"><p className="text-xs text-slate-400">Contribuciones patronales</p><p className="text-xl font-bold text-slate-800">{fmtMoney(sum('contribuciones'))}</p><p className="text-xs text-slate-400 mt-1">SIPA {pct('co_sipa')}% · PAMI {pct('co_ley19032')}% · O. social {pct('co_obra_social')}% · FATERYH {pct('co_fateryh')}% · ART {pct('co_art_pct')}%{pct('co_art_fijo') ? ` + ${fmtMoney(pct('co_art_fijo'))}` : ''}{pct('co_seguro_vida') ? ` · Seg. vida ${fmtMoney(pct('co_seguro_vida'))}` : ''}</p></Card>
            <Card className="p-5"><p className="text-xs text-slate-400">Total a depositar (F.931 + sindicato)</p><p className="text-xl font-bold text-teal-600">{fmtMoney(round2(sum('aportes') + sum('contribuciones')))}</p><p className="text-xs text-slate-400 mt-1">Sobre una masa remunerativa de {fmtMoney(sum('bruto'))}</p></Card>
          </div>
          <Card>
            <h3 className="font-semibold text-slate-700 mb-3">Detalle por concepto · {periodoLabel(periodo)}</h3>
            <Table headers={['Concepto', 'Quién lo paga', '%', 'Importe']}>
              {[['Jubilación (SIPA)', 'Empleado', 'ap_jubilacion'], ['Ley 19.032 (PAMI)', 'Empleado', 'ap_ley19032'], ['Obra social', 'Empleado', 'ap_obra_social'], ['Cuota sindical SUTERH', 'Empleado', 'ap_sindicato'], ['FATERYH', 'Empleado', 'ap_fateryh'],
                ['Jubilación + asignaciones + FNE', 'Consorcio', 'co_sipa'], ['Ley 19.032 (PAMI)', 'Consorcio', 'co_ley19032'], ['Obra social', 'Consorcio', 'co_obra_social'], ['FATERYH', 'Consorcio', 'co_fateryh'], ['ART', 'Consorcio', 'co_art_pct']].map(([n, q, k]) => (
                <tr key={k} className="hover:bg-slate-50"><Td>{n}</Td><Td className="text-slate-500">{q}</Td><Td>{pct(k)}%</Td><Td className="font-medium">{fmtMoney(round2(sum('bruto') * pct(k) / 100))}</Td></tr>
              ))}
              {(pct('co_art_fijo') > 0 || pct('co_seguro_vida') > 0) && <tr><Td>ART cuota fija + seguro de vida</Td><Td className="text-slate-500">Consorcio</Td><Td>—</Td><Td className="font-medium">{fmtMoney(round2((pct('co_art_fijo') + pct('co_seguro_vida')) * liqsPeriodo.length))}</Td></tr>}
            </Table>
            <p className="text-xs text-slate-400 mt-3">Los porcentajes se editan en la pestaña Parámetros. La presentación del F.931 en ARCA la hace el contador con la exportación "Para el contador".</p>
          </Card>
        </>
      ) : tab === 'empleados' ? (
        empleados.length === 0 ? <Card><EmptyState icon={<Users size={28} />} title="Sin empleados cargados" /></Card> : (
          <Card>
            <Table headers={['Nombre', 'CUIL', 'Cargo / categoría', 'Básico', 'Ingreso', 'Antig.', 'Vac./año', 'Adicionales', 'Vivienda', 'Estado', '']}>
              {empleados.map((e) => {
                const esc = basicoEscala(e);
                const anios = aniosAntiguedad(e.antiguedad_fecha);
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <Td className="font-medium">{e.nombre}</Td>
                    <Td className="font-mono text-xs">{e.cuil || '—'}</Td>
                    <Td className="capitalize">{e.cargo.replace('_', ' ')}<div className="text-xs text-slate-400 normal-case">{e.categoria || ''}</div></Td>
                    <Td className="font-semibold">{e.usar_escala ? (esc ? <>{fmtMoney(Number(esc))}<div className="text-xs text-slate-400">escala</div></> : <span className="text-red-500 text-xs">sin escala</span>) : fmtMoney(Number(e.sueldo_basico))}</Td>
                    <Td>{fmtDate(e.antiguedad_fecha)}</Td>
                    <Td>{anios} años</Td>
                    <Td>{diasVacaciones(anios)} días</Td>
                    <Td className="text-xs text-slate-500">{[e.adic_titulo && 'título', e.adic_vidrios && 'vidrios', e.adic_residuos && 'residuos', e.adic_jardin && 'jardín'].filter(Boolean).join(', ') || '—'}</Td>
                    <Td>{e.vive_en_edificio ? 'Sí' : 'No'}</Td>
                    <Td><Badge color={e.activo ? 'green' : 'slate'}>{e.activo ? 'activo' : 'baja'}</Badge></Td>
                    <Td><div className="flex gap-1">
                      <button onClick={() => { setEditingEmp(e); setEmpForm({ nombre: e.nombre, cuil: e.cuil || '', cargo: e.cargo, categoria: e.categoria || '', usar_escala: e.usar_escala, sueldo_basico: String(e.sueldo_basico), antiguedad_fecha: e.antiguedad_fecha || '', fecha_egreso: e.fecha_egreso || '', vive_en_edificio: e.vive_en_edificio, jornada: e.jornada || 'completa', obra_social: e.obra_social || '', cbu: e.cbu || '', adic_titulo: e.adic_titulo, adic_vidrios: e.adic_vidrios, adic_residuos: e.adic_residuos, adic_jardin: e.adic_jardin, activo: e.activo }); setEmpModal(true); }} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteEmp(e)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div></Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        )
      ) : tab === 'escala' ? (
        <>
          <Card className="mb-4">
            <h3 className="font-semibold text-slate-700 mb-1">Cargar básico de convenio</h3>
            <p className="text-xs text-slate-400 mb-3">Una fila por categoría y fecha de vigencia. En cada paritaria cargás la nueva vigencia; las anteriores quedan para liquidar períodos viejos. Los empleados con "usar escala" toman el básico de acá.</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <Input label="Categoría" value={escForm.categoria} onChange={(v) => setEscForm({ ...escForm, categoria: v })} placeholder="Encargado permanente c/viv." />
              <Input label="Básico" type="number" step="0.01" value={escForm.basico} onChange={(v) => setEscForm({ ...escForm, basico: v })} />
              <Input label="Vigencia desde" type="date" value={escForm.vigencia_desde} onChange={(v) => setEscForm({ ...escForm, vigencia_desde: v })} />
              <Input label="Notas" value={escForm.notas} onChange={(v) => setEscForm({ ...escForm, notas: v })} placeholder="Paritaria oct/26" />
              <Button onClick={guardarEscala} disabled={busy}><Plus size={15} /> Guardar</Button>
            </div>
          </Card>
          <Card>
            <Table headers={['Categoría', 'Básico', 'Vigencia desde', 'Notas', '']}>
              {escalas.map((x) => (
                <tr key={x.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{x.categoria}</Td><Td className="font-semibold">{fmtMoney(Number(x.basico))}</Td><Td>{fmtDate(x.vigencia_desde)}</Td><Td className="text-slate-500">{x.notas || ''}</Td>
                  <Td><button onClick={() => run(async () => { await supabase.from('convenio_escalas').delete().eq('id', x.id); })} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td>
                </tr>
              ))}
              {escalas.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-400 py-8">Sin escala cargada. Podés seguir usando el básico de cada empleado.</Td></tr>}
            </Table>
          </Card>
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {(['aportes', 'contribuciones', 'convenio'] as const).map((g) => (
            <Card key={g}>
              <h3 className="font-semibold text-slate-700 capitalize mb-3">{g === 'convenio' ? 'Convenio y adicionales' : g === 'aportes' ? 'Aportes del empleado (%)' : 'Contribuciones del consorcio'}</h3>
              <div className="space-y-3">
                {parametros.filter((p) => p.grupo === g).map((p) => (
                  <Input key={p.clave} label={p.descripcion} type="number" step="0.01" value={paramEdit[p.clave] ?? ''} onChange={(v) => setParamEdit({ ...paramEdit, [p.clave]: v })} />
                ))}
              </div>
            </Card>
          ))}
          <p className="text-xs text-slate-400 lg:col-span-3">Los valores por defecto son los habituales del convenio de encargados; confirmalos con el contador (ART y seguro de vida dependen de la póliza del consorcio). Los adicionales en $ se actualizan con cada paritaria.</p>
        </div>
      )}

      {/* ---------- Modales ---------- */}
      <Modal open={empModal} onClose={() => setEmpModal(false)} title={editingEmp ? 'Editar empleado' : 'Nuevo empleado'} size="lg">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="col-span-2"><Input label="Nombre y apellido" value={empForm.nombre} onChange={(v) => setEmpForm({ ...empForm, nombre: v })} required /></div>
          <Input label="CUIL" value={empForm.cuil} onChange={(v) => setEmpForm({ ...empForm, cuil: v })} />
          <Select label="Cargo" value={empForm.cargo} onChange={(v) => setEmpForm({ ...empForm, cargo: v })} options={cargos.map((c) => ({ value: c, label: c.replace('_', ' ') }))} />
          {categorias.length ? <Select label="Categoría convenio" value={empForm.categoria} onChange={(v) => setEmpForm({ ...empForm, categoria: v, usar_escala: !!v })} placeholder="— Sin categoría —" options={categorias.map((c) => ({ value: c, label: c }))} />
            : <Input label="Categoría convenio" value={empForm.categoria} onChange={(v) => setEmpForm({ ...empForm, categoria: v })} placeholder="Encargado permanente c/viv." />}
          <Select label="Jornada" value={empForm.jornada} onChange={(v) => setEmpForm({ ...empForm, jornada: v })} options={[{ value: 'completa', label: 'Completa' }, { value: 'media', label: 'Media jornada' }, { value: 'por_hora', label: 'Por hora' }]} />
          <Input label={empForm.usar_escala ? 'Básico (lo toma de la escala)' : 'Sueldo básico'} type="number" step="0.01" value={empForm.sueldo_basico} onChange={(v) => setEmpForm({ ...empForm, sueldo_basico: v })} />
          <Input label="Fecha de ingreso" type="date" value={empForm.antiguedad_fecha} onChange={(v) => setEmpForm({ ...empForm, antiguedad_fecha: v })} />
          <Input label="Fecha de egreso" type="date" value={empForm.fecha_egreso} onChange={(v) => setEmpForm({ ...empForm, fecha_egreso: v, activo: v ? false : empForm.activo })} />
          <Input label="Obra social" value={empForm.obra_social} onChange={(v) => setEmpForm({ ...empForm, obra_social: v })} placeholder="OSPERYH" />
          <div className="col-span-2"><Input label="CBU para el pago" value={empForm.cbu} onChange={(v) => setEmpForm({ ...empForm, cbu: v })} /></div>
          <div className="col-span-full grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
            {([['usar_escala', 'Usar básico de escala'], ['adic_titulo', 'Adicional título'], ['adic_vidrios', 'Limpieza de vidrios'], ['adic_residuos', 'Retiro de residuos'], ['adic_jardin', 'Jardín'], ['vive_en_edificio', 'Vive en el edificio'], ['activo', 'Activo']] as [keyof typeof empVacio, string][]).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={!!empForm[k]} onChange={(e) => setEmpForm({ ...empForm, [k]: e.target.checked })} className="rounded" /> {l}</label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setEmpModal(false)}>Cancelar</Button><Button onClick={saveEmp} disabled={busy}>Guardar</Button></div>
      </Modal>

      <Modal open={!!novModal} onClose={() => setNovModal(null)} title={`Novedades · ${novModal?.empleados?.nombre} · ${novModal ? periodoLabel(novModal.periodo) : ''}`} size="lg">
        {nov && novModal?.empleados && (() => {
          const e = novModal.empleados;
          const anios = aniosAntiguedad(e.antiguedad_fecha, `${novModal.periodo}-28`);
          return <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Input label="Básico del mes" type="number" step="0.01" value={nov.basico} onChange={(v) => setNov({ ...nov, basico: v })} />
              <Input label="Adicionales rem. ($)" type="number" step="0.01" value={nov.adicionales} onChange={(v) => setNov({ ...nov, adicionales: v })} />
              <Input label="Horas extras 50%" type="number" step="0.5" value={nov.horas_50} onChange={(v) => setNov({ ...nov, horas_50: v })} />
              <Input label="Horas extras 100%" type="number" step="0.5" value={nov.horas_100} onChange={(v) => setNov({ ...nov, horas_100: v })} />
              <Input label={`Días de vacaciones (le corresponden ${diasVacaciones(anios)})`} type="number" value={nov.dias_vacaciones} onChange={(v) => setNov({ ...nov, dias_vacaciones: v })} />
              <Input label="No remunerativo ($)" type="number" step="0.01" value={nov.no_remunerativo} onChange={(v) => setNov({ ...nov, no_remunerativo: v })} />
              <Input label="Otros descuentos ($)" type="number" step="0.01" value={nov.descuentos} onChange={(v) => setNov({ ...nov, descuentos: v })} placeholder="Adelantos, embargos" />
              <div className="flex flex-col gap-1 pt-5">
                <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={nov.sac} onChange={(ev) => setNov({ ...nov, sac: ev.target.checked })} className="rounded" /> Liquidar SAC</label>
                {nov.sac && <input type="number" step="0.01" placeholder="Monto (vacío = 50% del mes)" value={nov.sac_monto} onChange={(ev) => setNov({ ...nov, sac_monto: ev.target.value })} className="text-sm border border-slate-200 rounded px-2 py-1" />}
              </div>
              <div className="col-span-full"><Textarea label="Observaciones (salen en el recibo)" value={nov.observaciones} onChange={(v) => setNov({ ...nov, observaciones: v })} rows={2} /></div>
            </div>
            <p className="text-xs text-slate-400 mt-3">Valor hora = (básico + antigüedad) / {params.cv_horas_mes || 200}. SAC: 50% de la mejor remuneración del semestre; si fue otro mes, cargá el monto a mano. Plus vacacional = (remuneración/25 − remuneración/30) × días.</p>
            <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setNovModal(null)}>Cancelar</Button><Button onClick={aplicarNovedades} disabled={busy}>Recalcular recibo</Button></div>
          </>;
        })()}
      </Modal>

      <Modal open={!!pagarTarget} onClose={() => setPagarTarget(null)} title={`Pagar sueldo · ${pagarTarget?.empleados?.nombre}`} size="sm">
        <p className="text-sm text-slate-600 mb-3">Sale de caja el neto <b>{fmtMoney(Number(pagarTarget?.neto || 0))}</b> y entra a las expensas un gasto por el costo total <b>{fmtMoney(Number(pagarTarget?.costo_total || 0))}</b> (bruto + cargas + no remunerativo).</p>
        <Input label="Fecha de pago" type="date" value={fechaPago} onChange={setFechaPago} />
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setPagarTarget(null)}>Cancelar</Button><Button onClick={pagar} disabled={busy}>Confirmar pago</Button></div>
      </Modal>

      <ConfirmDialog open={!!deleteEmp} title="Eliminar empleado" message={`¿Eliminar a ${deleteEmp?.nombre}? Se borran también sus liquidaciones. Si dejó de trabajar, mejor cargale la fecha de egreso.`}
        onCancel={() => setDeleteEmp(null)} onConfirm={() => { const e = deleteEmp; setDeleteEmp(null); if (e) run(async () => { await supabase.from('empleados').delete().eq('id', e.id); }); }} />
      <ConfirmDialog open={!!borrarLiq} title="Eliminar liquidación" message={`¿Eliminar el recibo de ${borrarLiq?.empleados?.nombre} de ${borrarLiq ? periodoLabel(borrarLiq.periodo) : ''}?`}
        onCancel={() => setBorrarLiq(null)} onConfirm={() => { const l = borrarLiq; setBorrarLiq(null); if (l) run(async () => { await supabase.from('sueldo_liquidaciones').delete().eq('id', l.id); }); }} />
    </div>
  );
}

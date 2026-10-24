import { useEffect, useState } from 'react';
import { Calculator, Plus, Pencil, Receipt, Trash2, Users, WalletCards } from 'lucide-react';
import { supabase, type Empleado, type Rubro, type SueldoLiquidacion } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { calcularSueldo, fmtMoney, hoyISO, periodoActual, round2, cuentaPredeterminada } from '@/lib/engine';

const cargos = ['encargado', 'ayudante', 'suplente', 'personal_limpieza', 'vigilancia', 'otro'];

export function Sueldos() {
  const { consorcio } = useApp();
  const [tab, setTab] = useState('liquidaciones');
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [liqs, setLiqs] = useState<SueldoLiquidacion[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState(periodoActual());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [empModal, setEmpModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Empleado | null>(null);
  const [empForm, setEmpForm] = useState({ nombre: '', cuil: '', cargo: 'encargado', categoria: '', sueldo_basico: '', antiguedad_fecha: '', vive_en_edificio: false, activo: true });
  const [deleteEmp, setDeleteEmp] = useState<Empleado | null>(null);
  const [ajusteModal, setAjusteModal] = useState<SueldoLiquidacion | null>(null);
  const [ajusteForm, setAjusteForm] = useState({ adicionales: '0', no_remunerativo: '0' });

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [e, l, r] = await Promise.all([
      supabase.from('empleados').select('*').eq('consorcio_id', consorcio.id).order('nombre'),
      supabase.from('sueldo_liquidaciones').select('*, empleados(*)').eq('consorcio_id', consorcio.id).order('periodo', { ascending: false }),
      supabase.from('rubros').select('*').order('orden'),
    ]);
    setEmpleados((e.data as Empleado[]) || []);
    setLiqs((l.data as SueldoLiquidacion[]) || []);
    setRubros((r.data as Rubro[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  /** Preliquidar: genera la liquidación del período para cada empleado activo que no la tenga. */
  const preliquidar = async () => {
    if (!consorcio) return;
    setBusy(true); setMsg('');
    const activos = empleados.filter((e) => e.activo);
    if (activos.length === 0) { setMsg('No hay empleados activos cargados.'); setBusy(false); return; }
    let n = 0;
    for (const e of activos) {
      if (liqs.some((l) => l.empleado_id === e.id && l.periodo === periodo)) continue;
      const calc = calcularSueldo(e);
      const { error } = await supabase.from('sueldo_liquidaciones').insert({ consorcio_id: consorcio.id, empleado_id: e.id, periodo, ...calc });
      if (!error) n++;
    }
    setMsg(n > 0 ? `Se preliquidaron ${n} recibos del período ${periodo}.` : `Todos los empleados activos ya tienen liquidación en ${periodo}.`);
    setBusy(false);
    load();
  };

  const confirmarLiq = async (l: SueldoLiquidacion) => {
    await supabase.from('sueldo_liquidaciones').update({ estado: 'liquidada' }).eq('id', l.id);
    load();
  };

  /** Pasar a expensas: genera el gasto del costo total (bruto + contribuciones) en categoría A. */
  const pasarAGastos = async (l: SueldoLiquidacion) => {
    if (!consorcio || l.gasto_id) return;
    const rubroSueldos = rubros.find((r) => r.nombre.toLowerCase().includes('sueldos'));
    const { data: gasto, error } = await supabase.from('gastos').insert({
      consorcio_id: consorcio.id, descripcion: `Sueldo ${l.empleados?.nombre} ${l.periodo} (c/cargas)`,
      rubro_id: rubroSueldos?.id || null, categoria: 'A', monto: Number(l.costo_total), fecha: hoyISO(),
    }).select().single();
    if (!error && gasto) {
      await supabase.from('sueldo_liquidaciones').update({ estado: 'pagada', gasto_id: gasto.id }).eq('id', l.id);
      await supabase.from('movimientos').insert({
        consorcio_id: consorcio.id, cuenta_id: await cuentaPredeterminada(consorcio.id), fecha: hoyISO(), tipo: 'egreso',
        concepto: `Sueldo ${l.empleados?.nombre} ${l.periodo}`, monto: Number(l.neto), origen: 'sueldo', origen_id: l.id,
      });
      setMsg('Sueldo marcado como pagado: se generó el gasto pendiente (costo total con cargas) y el egreso de caja (neto).');
    }
    load();
  };

  const aplicarAjuste = async () => {
    if (!ajusteModal?.empleados) return;
    const calc = calcularSueldo(ajusteModal.empleados, parseFloat(ajusteForm.adicionales) || 0, parseFloat(ajusteForm.no_remunerativo) || 0);
    await supabase.from('sueldo_liquidaciones').update(calc).eq('id', ajusteModal.id);
    setAjusteModal(null);
    load();
  };

  const saveEmp = async () => {
    if (!consorcio || !empForm.nombre.trim()) return;
    const payload = {
      consorcio_id: consorcio.id, nombre: empForm.nombre.trim(), cuil: empForm.cuil || null,
      cargo: empForm.cargo, categoria: empForm.categoria || null,
      sueldo_basico: parseFloat(empForm.sueldo_basico) || 0,
      antiguedad_fecha: empForm.antiguedad_fecha || null,
      vive_en_edificio: empForm.vive_en_edificio, activo: empForm.activo,
    };
    const q = editingEmp ? supabase.from('empleados').update(payload).eq('id', editingEmp.id) : supabase.from('empleados').insert(payload);
    await q;
    setEmpModal(false);
    load();
  };

  if (!consorcio) return null;
  const liqsPeriodo = liqs.filter((l) => l.periodo === periodo);
  const totalAportes = round2(liqsPeriodo.reduce((a, l) => a + Number(l.aportes), 0));
  const totalContrib = round2(liqsPeriodo.reduce((a, l) => a + Number(l.contribuciones), 0));

  return (
    <div>
      <PageHeader title={`Sueldos · ${consorcio.nombre}`} subtitle="Personal del edificio y liquidación mensual (antigüedad 1%/año, aportes 17%, contribuciones 26,4%)"
        action={tab === 'empleados'
          ? <Button onClick={() => { setEditingEmp(null); setEmpForm({ nombre: '', cuil: '', cargo: 'encargado', categoria: '', sueldo_basico: '', antiguedad_fecha: '', vive_en_edificio: false, activo: true }); setEmpModal(true); }}><Plus size={16} /> Nuevo empleado</Button>
          : <div className="flex gap-2 items-end">
              <div className="w-40"><Input label="Período" type="month" value={periodo} onChange={setPeriodo} /></div>
              <Button onClick={preliquidar} disabled={busy}><Calculator size={15} /> Preliquidar sueldos</Button>
            </div>} />

      {msg && <div className="bg-emerald-50 text-emerald-700 text-sm rounded-lg px-4 py-2.5 mb-4">{msg}</div>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'liquidaciones', label: 'Liquidaciones', badge: liqsPeriodo.length },
        { key: 'aportes', label: 'Aportes y contribuciones' },
        { key: 'cargos', label: 'Cargos' },
        { key: 'empleados', label: 'Empleados', badge: empleados.length },
      ]} />

      {loading ? <Spinner /> : tab === 'liquidaciones' ? (
        liqsPeriodo.length === 0 ? (
          <Card><EmptyState icon={<WalletCards size={28} />} title={`No hay liquidaciones para ${periodo}`} subtitle='Para generarlas hacé click en "Preliquidar sueldos".' /></Card>
        ) : (
          <Card>
            <Table headers={['Empleado', 'Básico', 'Antig.', 'Adicionales', 'Bruto', 'Aportes (17%)', 'No rem.', 'Neto', 'Costo total', 'Estado', '']}>
              {liqsPeriodo.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{l.empleados?.nombre}</Td>
                  <Td>{fmtMoney(Number(l.basico))}</Td>
                  <Td>{fmtMoney(Number(l.antiguedad))}</Td>
                  <Td>{fmtMoney(Number(l.adicionales))}</Td>
                  <Td>{fmtMoney(Number(l.bruto))}</Td>
                  <Td className="text-red-500">-{fmtMoney(Number(l.aportes))}</Td>
                  <Td>{fmtMoney(Number(l.no_remunerativo))}</Td>
                  <Td className="font-semibold">{fmtMoney(Number(l.neto))}</Td>
                  <Td className="text-slate-500">{fmtMoney(Number(l.costo_total))}</Td>
                  <Td><Badge color={l.estado === 'pagada' ? 'green' : l.estado === 'liquidada' ? 'blue' : 'amber'}>{l.estado}</Badge></Td>
                  <Td>
                    <div className="flex gap-1">
                      {l.estado === 'preliquidada' && <>
                        <Button size="sm" variant="ghost" onClick={() => { setAjusteForm({ adicionales: String(l.adicionales), no_remunerativo: String(l.no_remunerativo) }); setAjusteModal(l); }}><Pencil size={13} /></Button>
                        <Button size="sm" variant="secondary" onClick={() => confirmarLiq(l)}>Confirmar</Button>
                      </>}
                      {l.estado === 'liquidada' && <Button size="sm" onClick={() => pasarAGastos(l)}><Receipt size={13} /> Pagar y pasar a gastos</Button>}
                      <button onClick={async () => { await supabase.from('sueldo_liquidaciones').delete().eq('id', l.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )
      ) : tab === 'aportes' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-5"><p className="text-xs text-slate-400">Aportes retenidos ({periodo})</p><p className="text-xl font-bold text-slate-800">{fmtMoney(totalAportes)}</p><p className="text-xs text-slate-400 mt-1">Jubilación 11% + Obra social 3% + Ley 19.032 3%</p></Card>
          <Card className="p-5"><p className="text-xs text-slate-400">Contribuciones patronales ({periodo})</p><p className="text-xl font-bold text-slate-800">{fmtMoney(totalContrib)}</p><p className="text-xs text-slate-400 mt-1">Cargas del consorcio como empleador (~26,4%)</p></Card>
          <Card className="p-5"><p className="text-xs text-slate-400">Total a depositar (F.931)</p><p className="text-xl font-bold text-teal-600">{fmtMoney(round2(totalAportes + totalContrib))}</p><p className="text-xs text-slate-400 mt-1">Aportes + contribuciones del período</p></Card>
        </div>
      ) : tab === 'cargos' ? (
        <Card>
          <Table headers={['Cargo', 'Empleados activos', 'Masa salarial (básicos)']}>
            {cargos.map((c) => {
              const del = empleados.filter((e) => e.cargo === c && e.activo);
              if (del.length === 0) return null;
              return (
                <tr key={c} className="hover:bg-slate-50">
                  <Td className="font-medium capitalize">{c.replace('_', ' ')}</Td>
                  <Td>{del.length}</Td>
                  <Td>{fmtMoney(del.reduce((a, e) => a + Number(e.sueldo_basico), 0))}</Td>
                </tr>
              );
            })}
            {empleados.filter((e) => e.activo).length === 0 && <tr><Td colSpan={3} className="text-center text-slate-400 py-10">Sin empleados activos</Td></tr>}
          </Table>
        </Card>
      ) : (
        empleados.length === 0 ? <Card><EmptyState icon={<Users size={28} />} title="Sin empleados cargados" /></Card> : (
          <Card>
            <Table headers={['Nombre', 'CUIL', 'Cargo', 'Categoría', 'Básico', 'Ingreso', 'Vive en edificio', 'Estado', '']}>
              {empleados.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{e.nombre}</Td>
                  <Td className="font-mono text-xs">{e.cuil || '—'}</Td>
                  <Td className="capitalize">{e.cargo.replace('_', ' ')}</Td>
                  <Td>{e.categoria || '—'}</Td>
                  <Td className="font-semibold">{fmtMoney(Number(e.sueldo_basico))}</Td>
                  <Td>{e.antiguedad_fecha ? e.antiguedad_fecha.split('-').reverse().join('/') : '—'}</Td>
                  <Td>{e.vive_en_edificio ? 'Sí' : 'No'}</Td>
                  <Td><Badge color={e.activo ? 'green' : 'slate'}>{e.activo ? 'activo' : 'baja'}</Badge></Td>
                  <Td>
                    <div className="flex gap-1">
                      <button onClick={() => {
                        setEditingEmp(e);
                        setEmpForm({ nombre: e.nombre, cuil: e.cuil || '', cargo: e.cargo, categoria: e.categoria || '', sueldo_basico: String(e.sueldo_basico), antiguedad_fecha: e.antiguedad_fecha || '', vive_en_edificio: e.vive_en_edificio, activo: e.activo });
                        setEmpModal(true);
                      }} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteEmp(e)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )
      )}

      <Modal open={empModal} onClose={() => setEmpModal(false)} title={editingEmp ? 'Editar empleado' : 'Nuevo empleado'}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Input label="Nombre y apellido" value={empForm.nombre} onChange={(v) => setEmpForm({ ...empForm, nombre: v })} required /></div>
          <Input label="CUIL" value={empForm.cuil} onChange={(v) => setEmpForm({ ...empForm, cuil: v })} />
          <Select label="Cargo" value={empForm.cargo} onChange={(v) => setEmpForm({ ...empForm, cargo: v })} options={cargos.map((c) => ({ value: c, label: c.replace('_', ' ') }))} />
          <Input label="Categoría (escalafón)" value={empForm.categoria} onChange={(v) => setEmpForm({ ...empForm, categoria: v })} placeholder="Ej: Encargado permanente c/vivienda" />
          <Input label="Sueldo básico" type="number" step="0.01" value={empForm.sueldo_basico} onChange={(v) => setEmpForm({ ...empForm, sueldo_basico: v })} />
          <Input label="Fecha de ingreso" type="date" value={empForm.antiguedad_fecha} onChange={(v) => setEmpForm({ ...empForm, antiguedad_fecha: v })} />
          <div className="flex flex-col gap-2 pt-6">
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={empForm.vive_en_edificio} onChange={(e) => setEmpForm({ ...empForm, vive_en_edificio: e.target.checked })} className="rounded" /> Vive en el edificio</label>
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={empForm.activo} onChange={(e) => setEmpForm({ ...empForm, activo: e.target.checked })} className="rounded" /> Activo</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setEmpModal(false)}>Cancelar</Button>
          <Button onClick={saveEmp}>Guardar</Button>
        </div>
      </Modal>

      <Modal open={!!ajusteModal} onClose={() => setAjusteModal(null)} title={`Ajustar recibo · ${ajusteModal?.empleados?.nombre}`} size="sm">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Adicionales (rem.)" type="number" step="0.01" value={ajusteForm.adicionales} onChange={(v) => setAjusteForm({ ...ajusteForm, adicionales: v })} />
          <Input label="No remunerativo" type="number" step="0.01" value={ajusteForm.no_remunerativo} onChange={(v) => setAjusteForm({ ...ajusteForm, no_remunerativo: v })} />
        </div>
        <p className="text-xs text-slate-400 mt-3">El bruto, aportes, neto y costo total se recalculan automáticamente.</p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setAjusteModal(null)}>Cancelar</Button>
          <Button onClick={aplicarAjuste}>Recalcular</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteEmp} title="Eliminar empleado" message={`¿Eliminar a ${deleteEmp?.nombre}? Se borran también sus liquidaciones.`}
        onCancel={() => setDeleteEmp(null)}
        onConfirm={async () => { if (deleteEmp) { await supabase.from('empleados').delete().eq('id', deleteEmp.id); setDeleteEmp(null); load(); } }} />
    </div>
  );
}

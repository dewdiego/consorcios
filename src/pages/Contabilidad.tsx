import { useEffect, useState } from 'react';
import { BarChart3, Landmark, Plus, Trash2 } from 'lucide-react';
import { supabase, type Cuenta, type Movimiento, type Proveedor, type Retencion } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs } from '@/components/ui';
import { fmtDate, fmtMoney, hoyISO, periodoActual, round2 } from '@/lib/engine';

export function Contabilidad() {
  const { consorcio } = useApp();
  const [tab, setTab] = useState('movimientos');
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [retenciones, setRetenciones] = useState<Retencion[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState(periodoActual());

  const [movModal, setMovModal] = useState(false);
  const [movForm, setMovForm] = useState({ cuenta_id: '', fecha: hoyISO(), tipo: 'ingreso', concepto: '', monto: '' });
  const [ctaModal, setCtaModal] = useState(false);
  const [ctaForm, setCtaForm] = useState({ nombre: '', tipo: 'caja', banco: '', cbu: '', saldo_inicial: '0' });
  const [retModal, setRetModal] = useState(false);
  const [retForm, setRetForm] = useState({ proveedor_id: '', tipo: 'ganancias', monto: '', fecha: hoyISO(), certificado: '' });

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [m, c, r, p] = await Promise.all([
      supabase.from('movimientos').select('*, cuentas(*)').eq('consorcio_id', consorcio.id).order('fecha', { ascending: false }).limit(500),
      supabase.from('cuentas').select('*').eq('consorcio_id', consorcio.id).order('nombre'),
      supabase.from('retenciones').select('*, proveedores(*)').eq('consorcio_id', consorcio.id).order('fecha', { ascending: false }),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
    ]);
    setMovs((m.data as Movimiento[]) || []);
    setCuentas((c.data as Cuenta[]) || []);
    setRetenciones((r.data as Retencion[]) || []);
    setProveedores((p.data as Proveedor[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const crearMov = async () => {
    if (!consorcio || !movForm.concepto.trim() || !movForm.monto) return;
    await supabase.from('movimientos').insert({
      consorcio_id: consorcio.id, cuenta_id: movForm.cuenta_id || null, fecha: movForm.fecha,
      tipo: movForm.tipo, concepto: movForm.concepto.trim(), monto: parseFloat(movForm.monto), origen: 'manual',
    });
    setMovModal(false); setMovForm({ cuenta_id: '', fecha: hoyISO(), tipo: 'ingreso', concepto: '', monto: '' });
    load();
  };

  const crearCuenta = async () => {
    if (!consorcio || !ctaForm.nombre.trim()) return;
    await supabase.from('cuentas').insert({
      consorcio_id: consorcio.id, nombre: ctaForm.nombre.trim(), tipo: ctaForm.tipo,
      banco: ctaForm.banco || null, cbu: ctaForm.cbu || null, saldo_inicial: parseFloat(ctaForm.saldo_inicial) || 0,
    });
    setCtaModal(false); setCtaForm({ nombre: '', tipo: 'caja', banco: '', cbu: '', saldo_inicial: '0' });
    load();
  };

  const crearRet = async () => {
    if (!consorcio || !retForm.monto) return;
    await supabase.from('retenciones').insert({
      consorcio_id: consorcio.id, proveedor_id: retForm.proveedor_id || null, tipo: retForm.tipo,
      monto: parseFloat(retForm.monto), fecha: retForm.fecha, certificado: retForm.certificado || null,
    });
    setRetModal(false); setRetForm({ proveedor_id: '', tipo: 'ganancias', monto: '', fecha: hoyISO(), certificado: '' });
    load();
  };

  const toggleConciliado = async (m: Movimiento) => {
    await supabase.from('movimientos').update({ conciliado: !m.conciliado }).eq('id', m.id);
    load();
  };

  if (!consorcio) return null;

  // ---- Saldos del período: saldo inicial (histórico previo) + ingresos − egresos ----
  const desde = `${periodo}-01`;
  const hasta = `${periodo}-31`;
  const movsPeriodo = movs.filter((m) => m.fecha >= desde && m.fecha <= hasta);
  const previos = movs.filter((m) => m.fecha < desde);
  const saldoInicialCuentas = cuentas.reduce((a, c) => a + Number(c.saldo_inicial), 0);
  const saldoInicial = round2(saldoInicialCuentas + previos.reduce((a, m) => a + (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto)), 0));
  const ingresos = round2(movsPeriodo.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0));
  const egresos = round2(movsPeriodo.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0));
  const saldoFinal = round2(saldoInicial + ingresos - egresos);

  return (
    <div>
      <PageHeader title={`Contabilidad · ${consorcio.nombre}`} subtitle="Caja y bancos: los cobros de expensas y pagos a proveedores impactan acá automáticamente"
        action={
          tab === 'movimientos' ? <Button onClick={() => setMovModal(true)}><Plus size={16} /> Movimiento manual</Button>
            : tab === 'cuentas' ? <Button onClick={() => setCtaModal(true)}><Plus size={16} /> Nueva cuenta</Button>
            : tab === 'retenciones' ? <Button onClick={() => setRetModal(true)}><Plus size={16} /> Nueva retención</Button>
            : <div className="w-40"><Input label="Período" type="month" value={periodo} onChange={setPeriodo} /></div>
        } />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'movimientos', label: 'Movimientos', badge: movs.length },
        { key: 'saldos', label: 'Saldos' },
        { key: 'cuentas', label: 'Cuentas', badge: cuentas.length },
        { key: 'conciliaciones', label: 'Conciliaciones', badge: movs.filter((m) => !m.conciliado).length },
        { key: 'retenciones', label: 'Retenciones', badge: retenciones.length },
      ]} />

      {loading ? <Spinner /> : tab === 'movimientos' ? (
        movs.length === 0 ? <Card><EmptyState icon={<BarChart3 size={28} />} title="Sin movimientos" subtitle="Se generan al cobrar expensas y pagar órdenes, o cargalos a mano." /></Card> : (
          <Card>
            <Table headers={['Fecha', 'Concepto', 'Cuenta', 'Origen', 'Ingreso', 'Egreso']}>
              {movs.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <Td>{fmtDate(m.fecha)}</Td>
                  <Td className="font-medium max-w-sm truncate">{m.concepto}</Td>
                  <Td className="text-slate-500">{m.cuentas?.nombre || '—'}</Td>
                  <Td><Badge color={m.origen === 'pago' ? 'green' : m.origen === 'orden_pago' ? 'purple' : m.origen === 'sueldo' ? 'blue' : 'slate'}>{m.origen.replace('_', ' ')}</Badge></Td>
                  <Td className="text-emerald-600 font-medium">{m.tipo === 'ingreso' ? fmtMoney(Number(m.monto)) : ''}</Td>
                  <Td className="text-red-500 font-medium">{m.tipo === 'egreso' ? fmtMoney(Number(m.monto)) : ''}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )
      ) : tab === 'saldos' ? (
        <>
          <div className="w-40 mb-4"><Input label="Período" type="month" value={periodo} onChange={setPeriodo} /></div>
          <Card>
            <Table headers={['Fecha', 'Tipo', 'Descripción', 'Monto']}>
              <tr><Td>{fmtDate(desde)}</Td><Td><Badge color="teal">BALANCE</Badge></Td><Td className="font-medium">Saldo inicial</Td><Td className="font-semibold">{fmtMoney(saldoInicial)}</Td></tr>
              <tr><Td>{fmtDate(hasta)}</Td><Td><Badge color="green">CALCULADO</Badge></Td><Td className="font-medium">Ingresos por cobros</Td><Td className="font-semibold text-emerald-600">{fmtMoney(ingresos)}</Td></tr>
              <tr><Td>{fmtDate(hasta)}</Td><Td><Badge color="red">CALCULADO</Badge></Td><Td className="font-medium">Egresos (pagos y sueldos)</Td><Td className="font-semibold text-red-500">-{fmtMoney(egresos)}</Td></tr>
              <tr className="bg-slate-50"><Td colSpan={3} className="font-bold text-right">Saldo final</Td><Td className="font-bold">{fmtMoney(saldoFinal)}</Td></tr>
            </Table>
          </Card>
        </>
      ) : tab === 'cuentas' ? (
        cuentas.length === 0 ? <Card><EmptyState icon={<Landmark size={28} />} title="Sin cuentas" subtitle="Creá la caja y las cuentas bancarias del consorcio." /></Card> : (
          <Card>
            <Table headers={['Nombre', 'Tipo', 'Banco', 'CBU', 'Saldo inicial', 'Saldo actual', '']}>
              {cuentas.map((c) => {
                const propios = movs.filter((m) => m.cuenta_id === c.id);
                const saldo = round2(Number(c.saldo_inicial) + propios.reduce((a, m) => a + (m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto)), 0));
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td className="font-medium">{c.nombre}</Td>
                    <Td className="capitalize">{c.tipo}</Td>
                    <Td>{c.banco || '—'}</Td>
                    <Td className="font-mono text-xs">{c.cbu || '—'}</Td>
                    <Td>{fmtMoney(Number(c.saldo_inicial))}</Td>
                    <Td className={`font-semibold ${saldo < 0 ? 'text-red-500' : ''}`}>{fmtMoney(saldo)}</Td>
                    <Td><button onClick={async () => { await supabase.from('cuentas').delete().eq('id', c.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        )
      ) : tab === 'conciliaciones' ? (
        <Card>
          <Table headers={['✓', 'Fecha', 'Concepto', 'Cuenta', 'Monto', 'Estado']}>
            {movs.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <Td><input type="checkbox" className="rounded" checked={m.conciliado} onChange={() => toggleConciliado(m)} /></Td>
                <Td>{fmtDate(m.fecha)}</Td>
                <Td className="max-w-sm truncate">{m.concepto}</Td>
                <Td className="text-slate-500">{m.cuentas?.nombre || '—'}</Td>
                <Td className={m.tipo === 'ingreso' ? 'text-emerald-600' : 'text-red-500'}>{m.tipo === 'egreso' && '-'}{fmtMoney(Number(m.monto))}</Td>
                <Td><Badge color={m.conciliado ? 'green' : 'amber'}>{m.conciliado ? 'conciliado' : 'pendiente'}</Badge></Td>
              </tr>
            ))}
            {movs.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-400 py-10">Sin movimientos para conciliar</Td></tr>}
          </Table>
        </Card>
      ) : (
        <Card>
          <Table headers={['Fecha', 'Tipo', 'Proveedor', 'Certificado', 'Monto', '']}>
            {retenciones.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td>{fmtDate(r.fecha)}</Td>
                <Td className="uppercase font-medium">{r.tipo}</Td>
                <Td>{r.proveedores?.nombre || '—'}</Td>
                <Td className="text-slate-500">{r.certificado || '—'}</Td>
                <Td className="font-semibold">{fmtMoney(Number(r.monto))}</Td>
                <Td><button onClick={async () => { await supabase.from('retenciones').delete().eq('id', r.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td>
              </tr>
            ))}
            {retenciones.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-400 py-10">Sin retenciones registradas</Td></tr>}
          </Table>
        </Card>
      )}

      <Modal open={movModal} onClose={() => setMovModal(false)} title="Movimiento manual">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Tipo" value={movForm.tipo} onChange={(v) => setMovForm({ ...movForm, tipo: v })}
            options={[{ value: 'ingreso', label: 'Ingreso' }, { value: 'egreso', label: 'Egreso' }]} />
          <Select label="Cuenta" value={movForm.cuenta_id} onChange={(v) => setMovForm({ ...movForm, cuenta_id: v })} placeholder="— Sin cuenta —"
            options={cuentas.map((c) => ({ value: c.id, label: c.nombre }))} />
          <Input label="Fecha" type="date" value={movForm.fecha} onChange={(v) => setMovForm({ ...movForm, fecha: v })} />
          <Input label="Monto" type="number" step="0.01" value={movForm.monto} onChange={(v) => setMovForm({ ...movForm, monto: v })} required />
          <div className="col-span-2"><Input label="Concepto" value={movForm.concepto} onChange={(v) => setMovForm({ ...movForm, concepto: v })} required /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setMovModal(false)}>Cancelar</Button>
          <Button onClick={crearMov}>Guardar</Button>
        </div>
      </Modal>

      <Modal open={ctaModal} onClose={() => setCtaModal(false)} title="Nueva cuenta">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Nombre" value={ctaForm.nombre} onChange={(v) => setCtaForm({ ...ctaForm, nombre: v })} placeholder="Caja chica / Banco Nación" required />
          <Select label="Tipo" value={ctaForm.tipo} onChange={(v) => setCtaForm({ ...ctaForm, tipo: v })}
            options={[{ value: 'caja', label: 'Caja' }, { value: 'banco', label: 'Banco' }]} />
          <Input label="Banco" value={ctaForm.banco} onChange={(v) => setCtaForm({ ...ctaForm, banco: v })} />
          <Input label="CBU" value={ctaForm.cbu} onChange={(v) => setCtaForm({ ...ctaForm, cbu: v })} />
          <Input label="Saldo inicial" type="number" step="0.01" value={ctaForm.saldo_inicial} onChange={(v) => setCtaForm({ ...ctaForm, saldo_inicial: v })} />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setCtaModal(false)}>Cancelar</Button>
          <Button onClick={crearCuenta}>Guardar</Button>
        </div>
      </Modal>

      <Modal open={retModal} onClose={() => setRetModal(false)} title="Nueva retención">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Tipo" value={retForm.tipo} onChange={(v) => setRetForm({ ...retForm, tipo: v })}
            options={[{ value: 'ganancias', label: 'Ganancias' }, { value: 'iibb', label: 'IIBB' }, { value: 'suss', label: 'SUSS' }, { value: 'iva', label: 'IVA' }]} />
          <Select label="Proveedor" value={retForm.proveedor_id} onChange={(v) => setRetForm({ ...retForm, proveedor_id: v })} placeholder="— Elegir —"
            options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} />
          <Input label="Monto" type="number" step="0.01" value={retForm.monto} onChange={(v) => setRetForm({ ...retForm, monto: v })} required />
          <Input label="Fecha" type="date" value={retForm.fecha} onChange={(v) => setRetForm({ ...retForm, fecha: v })} />
          <div className="col-span-2"><Input label="N° certificado" value={retForm.certificado} onChange={(v) => setRetForm({ ...retForm, certificado: v })} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setRetModal(false)}>Cancelar</Button>
          <Button onClick={crearRet}>Guardar</Button>
        </div>
      </Modal>
    </div>
  );
}

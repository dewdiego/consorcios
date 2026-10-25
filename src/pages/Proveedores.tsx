import { useEffect, useState } from 'react';
import { CheckCircle2, Plus, Pencil, ShieldCheck, Trash2, Truck, XCircle } from 'lucide-react';
import { supabase, type Certificacion, type Gasto, type OrdenPago, type Proveedor } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, fmtMoney, hoyISO, periodoActual } from '@/lib/engine';

const categorias = ['limpieza', 'seguridad', 'mantenimiento', 'plomeria', 'electricidad', 'ascensores', 'jardineria', 'seguros', 'administracion', 'otros'];

export function Proveedores({ tab: tabInicial }: { tab: 'listado' | 'movimientos' | 'documentos' }) {
  const { usuario } = useApp();
  const [tab, setTab] = useState<string>(tabInicial);
  useEffect(() => setTab(tabInicial), [tabInicial]);

  const [items, setItems] = useState<Proveedor[]>([]);
  const [certs, setCerts] = useState<Certificacion[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [ops, setOps] = useState<OrdenPago[]>([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Proveedor | null>(null);
  const [form, setForm] = useState({ nombre: '', cuit: '', telefono: '', email: '', contacto: '', direccion: '', categoria: 'otros', cbu: '', activo: true, condicion_iva: 'ri', ret_ganancias: false, ret_ganancias_alic: '', ret_iibb: false, ret_iibb_alic: '', ret_suss: false, ret_suss_alic: '' });
  const [deleteTarget, setDeleteTarget] = useState<Proveedor | null>(null);

  const [certModal, setCertModal] = useState(false);
  const [certForm, setCertForm] = useState({ proveedor_id: '', requerimiento: '', periodo: periodoActual(), vencimiento: '' });
  const [fProvCert, setFProvCert] = useState('');
  const [fPeriodoCert, setFPeriodoCert] = useState('');
  const [fEstadoCert, setFEstadoCert] = useState('');

  const [fProvMov, setFProvMov] = useState('');

  const load = async () => {
    setLoading(true);
    const [p, c, g, o] = await Promise.all([
      supabase.from('proveedores').select('*').order('nombre'),
      supabase.from('proveedor_certificaciones').select('*, proveedores(*)').order('periodo', { ascending: false }),
      supabase.from('gastos').select('*, proveedores(*), consorcios(*)').not('proveedor_id', 'is', null).order('fecha', { ascending: false }).limit(300),
      supabase.from('ordenes_pago').select('*, proveedores(*)').order('fecha', { ascending: false }).limit(300),
    ]);
    setItems((p.data as Proveedor[]) || []);
    setCerts((c.data as Certificacion[]) || []);
    setGastos((g.data as Gasto[]) || []);
    setOps((o.data as OrdenPago[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ nombre: '', cuit: '', telefono: '', email: '', contacto: '', direccion: '', categoria: 'otros', cbu: '', activo: true, condicion_iva: 'ri', ret_ganancias: false, ret_ganancias_alic: '', ret_iibb: false, ret_iibb_alic: '', ret_suss: false, ret_suss_alic: '' }); setModal(true); };
  const openEdit = (p: Proveedor) => {
    setEditing(p);
    setForm({ nombre: p.nombre, cuit: p.cuit || '', telefono: p.telefono || '', email: p.email || '', contacto: p.contacto || '', direccion: p.direccion || '', categoria: p.categoria, cbu: p.cbu || '', activo: p.activo, condicion_iva: p.condicion_iva || 'ri', ret_ganancias: !!p.ret_ganancias, ret_ganancias_alic: p.ret_ganancias_alic == null ? '' : String(p.ret_ganancias_alic), ret_iibb: !!p.ret_iibb, ret_iibb_alic: p.ret_iibb_alic == null ? '' : String(p.ret_iibb_alic), ret_suss: !!p.ret_suss, ret_suss_alic: p.ret_suss_alic == null ? '' : String(p.ret_suss_alic) });
    setModal(true);
  };

  const save = async () => {
    if (!form.nombre.trim()) return;
    const payload = {
      nombre: form.nombre.trim(), cuit: form.cuit || null, telefono: form.telefono || null,
      email: form.email || null, contacto: form.contacto || null, direccion: form.direccion || null,
      categoria: form.categoria, cbu: form.cbu || null, activo: form.activo,
      condicion_iva: form.condicion_iva,
      ret_ganancias: form.ret_ganancias, ret_ganancias_alic: form.ret_ganancias_alic === '' ? null : parseFloat(form.ret_ganancias_alic),
      ret_iibb: form.ret_iibb, ret_iibb_alic: form.ret_iibb_alic === '' ? null : parseFloat(form.ret_iibb_alic),
      ret_suss: form.ret_suss, ret_suss_alic: form.ret_suss_alic === '' ? null : parseFloat(form.ret_suss_alic),
    };
    const q = editing ? supabase.from('proveedores').update(payload).eq('id', editing.id) : supabase.from('proveedores').insert(payload);
    await q;
    setModal(false); load();
  };

  const saveCert = async () => {
    if (!certForm.proveedor_id || !certForm.requerimiento.trim()) return;
    await supabase.from('proveedor_certificaciones').insert({
      proveedor_id: certForm.proveedor_id, requerimiento: certForm.requerimiento.trim(),
      periodo: certForm.periodo, vencimiento: certForm.vencimiento || null,
    });
    setCertModal(false); load();
  };

  const validarCert = async (c: Certificacion, validado: boolean) => {
    await supabase.from('proveedor_certificaciones').update({ validado, validado_por: validado ? usuario : null }).eq('id', c.id);
    load();
  };

  const certsVisibles = certs
    .filter((c) => !fProvCert || c.proveedor_id === fProvCert)
    .filter((c) => !fPeriodoCert || c.periodo === fPeriodoCert)
    .filter((c) => !fEstadoCert || (fEstadoCert === 'validado' ? c.validado : fEstadoCert === 'vencido' ? (c.vencimiento && c.vencimiento < hoyISO()) : !c.validado));

  const movimientos = [
    ...gastos.filter((g) => !fProvMov || g.proveedor_id === fProvMov).map((g) => ({
      fecha: g.fecha, tipo: 'Gasto', detalle: g.descripcion, proveedor: g.proveedores?.nombre || '—',
      consorcio: g.consorcios?.nombre || '—', monto: Number(g.monto), estado: g.pagado ? 'pagado' : 'impago',
    })),
    ...ops.filter((o) => !fProvMov || o.proveedor_id === fProvMov).map((o) => ({
      fecha: o.fecha, tipo: `OP-${String(o.numero).padStart(4, '0')}`, detalle: o.observaciones || 'Orden de pago',
      proveedor: o.proveedores?.nombre || 'Varios', consorcio: '—', monto: Number(o.monto), estado: o.estado,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  return (
    <div>
      <PageHeader title="Proveedores" subtitle="Padrón global de la administración, movimientos y certificación de documentación"
        action={tab === 'listado'
          ? <Button onClick={openNew}><Plus size={16} /> Nuevo proveedor</Button>
          : tab === 'documentos' ? <Button onClick={() => setCertModal(true)}><Plus size={16} /> Nuevo requerimiento</Button> : undefined} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'listado', label: 'Listado', badge: items.length },
        { key: 'movimientos', label: 'Movimientos históricos' },
        { key: 'documentos', label: 'Documentos / Certificación', badge: certs.filter((c) => !c.validado).length },
      ]} />

      {loading ? <Spinner /> : tab === 'listado' ? (
        items.length === 0 ? <Card><EmptyState icon={<Truck size={28} />} title="Sin proveedores" /></Card> : (
          <Card>
            <Table headers={['Nombre', 'Categoría', 'CUIT', 'Contacto', 'Teléfono', 'Email', 'Estado', '']}>
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{p.nombre}</Td>
                  <Td className="capitalize text-slate-500">{p.categoria}</Td>
                  <Td className="font-mono text-xs">{p.cuit || '—'}<div className="text-[10px] text-slate-400 font-sans">{p.condicion_iva === 'ri' ? 'RI' : p.condicion_iva === 'monotributo' ? 'Monotrib.' : 'Exento'}{[p.ret_ganancias && 'Gan', p.ret_iibb && 'IIBB', p.ret_suss && 'SUSS'].filter(Boolean).length ? ` · ret: ${[p.ret_ganancias && 'Gan', p.ret_iibb && 'IIBB', p.ret_suss && 'SUSS'].filter(Boolean).join('/')}` : ''}</div></Td>
                  <Td>{p.contacto || '—'}</Td>
                  <Td>{p.telefono || '—'}</Td>
                  <Td className="text-slate-500">{p.email || '—'}</Td>
                  <Td><Badge color={p.activo ? 'green' : 'slate'}>{p.activo ? 'activo' : 'inactivo'}</Badge></Td>
                  <Td>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteTarget(p)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )
      ) : tab === 'movimientos' ? (
        <>
          <Card className="p-4 mb-4">
            <div className="w-72">
              <Select label="Proveedor" value={fProvMov} onChange={setFProvMov} placeholder="Ver todos" options={items.map((p) => ({ value: p.id, label: p.nombre }))} />
            </div>
          </Card>
          <Card>
            <Table headers={['Fecha', 'Tipo', 'Detalle', 'Proveedor', 'Consorcio', 'Monto', 'Estado']}>
              {movimientos.map((m, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <Td>{fmtDate(m.fecha)}</Td>
                  <Td><Badge color={m.tipo === 'Gasto' ? 'blue' : 'purple'}>{m.tipo}</Badge></Td>
                  <Td className="max-w-sm truncate">{m.detalle}</Td>
                  <Td className="font-medium">{m.proveedor}</Td>
                  <Td className="text-slate-500">{m.consorcio}</Td>
                  <Td className="font-semibold">{fmtMoney(m.monto)}</Td>
                  <Td><Badge color={m.estado === 'pagado' || m.estado === 'pagada' ? 'green' : m.estado === 'anulada' ? 'slate' : 'amber'}>{m.estado}</Badge></Td>
                </tr>
              ))}
              {movimientos.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-400 py-10">Sin movimientos registrados.</Td></tr>}
            </Table>
          </Card>
        </>
      ) : (
        <>
          <Card className="p-4 mb-4">
            <div className="flex flex-wrap gap-3">
              <div className="w-64"><Select label="Proveedor" value={fProvCert} onChange={setFProvCert} placeholder="Ver todos" options={items.map((p) => ({ value: p.id, label: p.nombre }))} /></div>
              <div className="w-40"><Input label="Período" type="month" value={fPeriodoCert} onChange={setFPeriodoCert} /></div>
              <div className="w-44"><Select label="Estado" value={fEstadoCert} onChange={setFEstadoCert} placeholder="Ver todos"
                options={[{ value: 'validado', label: 'Validado' }, { value: 'pendiente', label: 'Pendiente' }, { value: 'vencido', label: 'Vencido' }]} /></div>
            </div>
          </Card>
          <Card>
            <Table headers={['Proveedor', 'Requerimiento', 'Período', 'Vencimiento', 'Validado', 'Validado por', '']}>
              {certsVisibles.map((c) => {
                const vencido = c.vencimiento && c.vencimiento < hoyISO();
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td className="font-medium">{c.proveedores?.nombre}</Td>
                    <Td>{c.requerimiento}</Td>
                    <Td>{c.periodo}</Td>
                    <Td className={vencido ? 'text-red-500 font-medium' : ''}>{fmtDate(c.vencimiento)}{vencido && ' ⚠'}</Td>
                    <Td><Badge color={c.validado ? 'green' : 'amber'}>{c.validado ? 'VALIDADO' : 'PENDIENTE'}</Badge></Td>
                    <Td className="text-slate-500 text-xs">{c.validado_por || '—'}</Td>
                    <Td>
                      <div className="flex gap-1">
                        {!c.validado
                          ? <Button size="sm" variant="secondary" onClick={() => validarCert(c, true)}><CheckCircle2 size={13} /> Validar</Button>
                          : <Button size="sm" variant="ghost" onClick={() => validarCert(c, false)}><XCircle size={13} /> Quitar</Button>}
                        <button onClick={async () => { await supabase.from('proveedor_certificaciones').delete().eq('id', c.id); load(); }}
                          className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {certsVisibles.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-400 py-10"><ShieldCheck size={24} className="mx-auto mb-2 text-slate-300" />No hay registros</Td></tr>}
            </Table>
          </Card>
        </>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar proveedor' : 'Nuevo proveedor'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Nombre / Razón social" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} required />
          <Select label="Categoría" value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })} options={categorias.map((c) => ({ value: c, label: c }))} />
          <Input label="CUIT" value={form.cuit} onChange={(v) => setForm({ ...form, cuit: v })} />
          <Input label="Contacto" value={form.contacto} onChange={(v) => setForm({ ...form, contacto: v })} />
          <Input label="Teléfono" value={form.telefono} onChange={(v) => setForm({ ...form, telefono: v })} />
          <Input label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Input label="Dirección" value={form.direccion} onChange={(v) => setForm({ ...form, direccion: v })} />
          <Input label="CBU / Alias" value={form.cbu} onChange={(v) => setForm({ ...form, cbu: v })} />
          <Select label="Condición frente al IVA" value={form.condicion_iva} onChange={(v) => setForm({ ...form, condicion_iva: v })}
            options={[{ value: 'ri', label: 'Responsable inscripto' }, { value: 'monotributo', label: 'Monotributista' }, { value: 'exento', label: 'Exento / no alcanzado' }]} />
        </div>
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-sm font-semibold text-slate-700 mb-1">Retenciones al pagarle</p>
          <p className="text-xs text-slate-400 mb-3">Al pagar una orden, el sistema calcula y descuenta lo marcado. Alícuota vacía = usa la de Parámetros. La base es el importe sin IVA si es responsable inscripto.</p>
          <div className="grid grid-cols-3 gap-3">
            {([['ret_ganancias', 'ret_ganancias_alic', 'Ganancias'], ['ret_iibb', 'ret_iibb_alic', 'Ingresos Brutos'], ['ret_suss', 'ret_suss_alic', 'SUSS']] as const).map(([k, ka, l]) => (
              <div key={k} className="rounded-lg border border-slate-200 p-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 font-medium mb-2"><input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} className="rounded" /> {l}</label>
                <Input label="Alícuota %" type="number" step="0.01" value={form[ka]} onChange={(v) => setForm({ ...form, [ka]: v })} placeholder="por defecto" />
              </div>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 mt-4">
          <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="rounded" /> Activo
        </label>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={save}>Guardar</Button>
        </div>
      </Modal>

      <Modal open={certModal} onClose={() => setCertModal(false)} title="Nuevo requerimiento de documentación">
        <Select label="Proveedor" value={certForm.proveedor_id} onChange={(v) => setCertForm({ ...certForm, proveedor_id: v })} placeholder="— Elegir —"
          options={items.map((p) => ({ value: p.id, label: p.nombre }))} required />
        <div className="grid grid-cols-2 gap-4 mt-4">
          <Input label="Requerimiento" value={certForm.requerimiento} onChange={(v) => setCertForm({ ...certForm, requerimiento: v })} placeholder="Seguro ART / F.931 / Matrícula" required />
          <Input label="Período" type="month" value={certForm.periodo} onChange={(v) => setCertForm({ ...certForm, periodo: v })} />
          <Input label="Vencimiento" type="date" value={certForm.vencimiento} onChange={(v) => setCertForm({ ...certForm, vencimiento: v })} />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setCertModal(false)}>Cancelar</Button>
          <Button onClick={saveCert}>Guardar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar proveedor"
        message={`¿Eliminar a ${deleteTarget?.nombre}? Sus gastos históricos quedan sin proveedor asignado.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('proveedores').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

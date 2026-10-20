import { useEffect, useState } from 'react';
import { PiggyBank, Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Provision, type Proveedor, type Rubro } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CATEGORIAS, fmtMoney } from '@/lib/engine';

/** Gastos fijos mensuales: se vuelcan a cada liquidación con "Generar provisiones y honorarios". */
export function Provisiones() {
  const { consorcio } = useApp();
  const [items, setItems] = useState<Provision[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Provision | null>(null);
  const [form, setForm] = useState({ descripcion: '', proveedor_id: '', rubro_id: '', categoria: 'A', monto_mensual: '', activa: true });
  const [deleteTarget, setDeleteTarget] = useState<Provision | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [p, pr, r] = await Promise.all([
      supabase.from('provisiones').select('*, proveedores(*), rubros(*)').eq('consorcio_id', consorcio.id).order('descripcion'),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('rubros').select('*').order('orden'),
    ]);
    setItems((p.data as Provision[]) || []);
    setProveedores((pr.data as Proveedor[]) || []);
    setRubros((r.data as Rubro[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const openNew = () => { setEditing(null); setForm({ descripcion: '', proveedor_id: '', rubro_id: '', categoria: 'A', monto_mensual: '', activa: true }); setModal(true); };
  const openEdit = (p: Provision) => {
    setEditing(p);
    setForm({ descripcion: p.descripcion, proveedor_id: p.proveedor_id || '', rubro_id: p.rubro_id || '', categoria: p.categoria, monto_mensual: String(p.monto_mensual), activa: p.activa });
    setModal(true);
  };

  const save = async () => {
    if (!consorcio || !form.descripcion.trim()) return;
    const payload = {
      consorcio_id: consorcio.id, descripcion: form.descripcion.trim(),
      proveedor_id: form.proveedor_id || null, rubro_id: form.rubro_id || null,
      categoria: form.categoria, monto_mensual: parseFloat(form.monto_mensual) || 0, activa: form.activa,
    };
    const q = editing ? supabase.from('provisiones').update(payload).eq('id', editing.id) : supabase.from('provisiones').insert(payload);
    await q;
    setModal(false); load();
  };

  if (!consorcio) return null;
  const totalMensual = items.filter((i) => i.activa).reduce((a, i) => a + Number(i.monto_mensual), 0);

  return (
    <div>
      <PageHeader title={`Provisiones · ${consorcio.nombre}`}
        subtitle={`Gastos fijos que se generan cada período · Total mensual activo: ${fmtMoney(totalMensual)}${Number(consorcio.honorarios_mensuales) > 0 ? ` (+ honorarios ${fmtMoney(Number(consorcio.honorarios_mensuales))})` : ''}`}
        action={<Button onClick={openNew}><Plus size={16} /> Nueva provisión</Button>} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<PiggyBank size={28} />} title="Sin provisiones" subtitle="Cargá abonos y gastos fijos (limpieza, ascensores, seguros) para generarlos con un click en cada liquidación." /></Card>
      ) : (
        <Card>
          <Table headers={['Descripción', 'Rubro', 'Proveedor', 'Cat.', 'Monto mensual', 'Estado', '']}>
            {items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-medium">{p.descripcion}</Td>
                <Td className="text-slate-500">{p.rubros?.nombre || '—'}</Td>
                <Td className="text-slate-500">{p.proveedores?.nombre || '—'}</Td>
                <Td><Badge color="teal">{p.categoria}</Badge></Td>
                <Td className="font-semibold">{fmtMoney(Number(p.monto_mensual))}</Td>
                <Td><Badge color={p.activa ? 'green' : 'slate'}>{p.activa ? 'activa' : 'inactiva'}</Badge></Td>
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
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar provisión' : 'Nueva provisión'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><Input label="Descripción" value={form.descripcion} onChange={(v) => setForm({ ...form, descripcion: v })} required /></div>
          <Select label="Rubro" value={form.rubro_id} onChange={(v) => setForm({ ...form, rubro_id: v })} placeholder="— Elegir —" options={rubros.map((r) => ({ value: r.id, label: r.nombre }))} />
          <Select label="Proveedor" value={form.proveedor_id} onChange={(v) => setForm({ ...form, proveedor_id: v })} placeholder="— Sin proveedor —" options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} />
          <Select label="Categoría" value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })} options={CATEGORIAS.map((c) => ({ value: c.key, label: c.label }))} />
          <Input label="Monto mensual" type="number" step="0.01" value={form.monto_mensual} onChange={(v) => setForm({ ...form, monto_mensual: v })} required />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 mt-4">
          <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} className="rounded" /> Activa
        </label>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={save}>Guardar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar provisión" message={`¿Eliminar "${deleteTarget?.descripcion}"? Los gastos ya generados no se tocan.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('provisiones').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

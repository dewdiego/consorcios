import { useEffect, useState } from 'react';
import { Phone, Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Telefono } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const categorias = ['emergencias', 'servicios', 'proveedor', 'encargado', 'consejo', 'otros'];
const catColor: Record<string, 'red' | 'blue' | 'purple' | 'teal' | 'amber' | 'slate'> = {
  emergencias: 'red', servicios: 'blue', proveedor: 'purple', encargado: 'teal', consejo: 'amber', otros: 'slate',
};

export function Telefonos() {
  const { consorcio, consorcios } = useApp();
  const [items, setItems] = useState<Telefono[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Telefono | null>(null);
  const [form, setForm] = useState({ consorcio_id: '', nombre: '', categoria: 'otros', telefono: '', notas: '' });
  const [deleteTarget, setDeleteTarget] = useState<Telefono | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('telefonos').select('*').order('categoria').order('nombre');
    setItems((data as Telefono[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const visibles = items
    .filter((t) => !consorcio || !t.consorcio_id || t.consorcio_id === consorcio.id)
    .filter((t) => !busqueda || t.nombre.toLowerCase().includes(busqueda.toLowerCase()) || t.telefono.includes(busqueda));

  const save = async () => {
    if (!form.nombre.trim() || !form.telefono.trim()) return;
    const payload = { consorcio_id: form.consorcio_id || null, nombre: form.nombre.trim(), categoria: form.categoria, telefono: form.telefono.trim(), notas: form.notas || null };
    const q = editing ? supabase.from('telefonos').update(payload).eq('id', editing.id) : supabase.from('telefonos').insert(payload);
    await q;
    setModal(false); load();
  };

  return (
    <div>
      <PageHeader title="Teléfonos útiles" subtitle="Agenda de emergencias, servicios y contactos"
        action={<Button onClick={() => { setEditing(null); setForm({ consorcio_id: consorcio?.id || '', nombre: '', categoria: 'otros', telefono: '', notas: '' }); setModal(true); }}><Plus size={16} /> Nuevo</Button>} />

      <div className="max-w-sm mb-4"><Input value={busqueda} onChange={setBusqueda} placeholder="Buscar por nombre o número…" /></div>

      {loading ? <Spinner /> : visibles.length === 0 ? (
        <Card><EmptyState icon={<Phone size={28} />} title="Agenda vacía" /></Card>
      ) : (
        <Card>
          <Table headers={['Nombre', 'Categoría', 'Teléfono', 'Notas', '']}>
            {visibles.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <Td className="font-medium">{t.nombre}</Td>
                <Td><Badge color={catColor[t.categoria] || 'slate'}>{t.categoria}</Badge></Td>
                <Td><a href={`tel:${t.telefono}`} className="text-teal-600 font-medium hover:underline">{t.telefono}</a></Td>
                <Td className="text-slate-500 max-w-xs truncate">{t.notas || '—'}</Td>
                <Td>
                  <div className="flex gap-1">
                    <button onClick={() => { setEditing(t); setForm({ consorcio_id: t.consorcio_id || '', nombre: t.nombre, categoria: t.categoria, telefono: t.telefono, notas: t.notas || '' }); setModal(true); }}
                      className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                    <button onClick={() => setDeleteTarget(t)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar contacto' : 'Nuevo contacto'}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Nombre" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} required />
          <Input label="Teléfono" value={form.telefono} onChange={(v) => setForm({ ...form, telefono: v })} required />
          <Select label="Categoría" value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })} options={categorias.map((c) => ({ value: c, label: c }))} />
          <Select label="Consorcio" value={form.consorcio_id} onChange={(v) => setForm({ ...form, consorcio_id: v })} placeholder="— General —"
            options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} />
          <div className="col-span-2"><Input label="Notas" value={form.notas} onChange={(v) => setForm({ ...form, notas: v })} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={save}>Guardar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar contacto" message={`¿Eliminar a ${deleteTarget?.nombre}?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('telefonos').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

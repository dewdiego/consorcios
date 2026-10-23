import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Users as UsersIcon } from 'lucide-react';
import { supabase, type Usuario } from '@/lib/supabase';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export function Usuarios() {
  const [items, setItems] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Usuario | null>(null);
  const [form, setForm] = useState({ nombre: '', email: '', rol: 'operador', activo: true });
  const [deleteTarget, setDeleteTarget] = useState<Usuario | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('usuarios').select('*').order('nombre');
    setItems((data as Usuario[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.nombre.trim() || !form.email.trim()) { setError('Nombre y email son obligatorios.'); return; }
    const payload = { nombre: form.nombre.trim(), email: form.email.trim().toLowerCase(), rol: form.rol, activo: form.activo };
    const q = editing ? supabase.from('usuarios').update(payload).eq('id', editing.id) : supabase.from('usuarios').insert(payload);
    const { error: err } = await q;
    if (err) { setError(err.code === '23505' ? 'Ya existe un usuario con ese email.' : err.message); return; }
    setModal(false); load();
  };

  return (
    <div>
      <PageHeader title="Usuarios" subtitle="Operadores habilitados para entrar a la app. Cada uno necesita además su cuenta (mail + contraseña) creada en Supabase → Authentication → Users"
        action={<Button onClick={() => { setEditing(null); setForm({ nombre: '', email: '', rol: 'operador', activo: true }); setError(''); setModal(true); }}><Plus size={16} /> Nuevo usuario</Button>} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<UsersIcon size={28} />} title="Sin usuarios cargados" /></Card>
      ) : (
        <Card>
          <Table headers={['Nombre', 'Email', 'Rol', 'Estado', '']}>
            {items.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <Td className="font-medium">{u.nombre}</Td>
                <Td className="text-slate-500">{u.email}</Td>
                <Td><Badge color={u.rol === 'admin' ? 'purple' : u.rol === 'operador' ? 'blue' : 'slate'}>{u.rol}</Badge></Td>
                <Td><Badge color={u.activo ? 'green' : 'slate'}>{u.activo ? 'activo' : 'inactivo'}</Badge></Td>
                <Td>
                  <div className="flex gap-1">
                    <button onClick={() => { setEditing(u); setForm({ nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo }); setError(''); setModal(true); }} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                    <button onClick={() => setDeleteTarget(u)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar usuario' : 'Nuevo usuario'}>
        <div className="space-y-4">
          <Input label="Nombre" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} required />
          <Input label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
          <Select label="Rol" value={form.rol} onChange={(v) => setForm({ ...form, rol: v })}
            options={[{ value: 'admin', label: 'Administrador' }, { value: 'operador', label: 'Operador' }, { value: 'consulta', label: 'Solo consulta' }]} />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="rounded" /> Activo
          </label>
        </div>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={save}>Guardar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar usuario" message={`¿Eliminar a ${deleteTarget?.nombre}?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('usuarios').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

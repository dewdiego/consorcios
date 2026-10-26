import { useEffect, useState } from 'react';
import { Mail, Pencil, Plus, Trash2, Users as UsersIcon } from 'lucide-react';
import { supabase, SUPABASE_URL, type Administracion, type Usuario } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Ayuda } from '@/components/Ayuda';

/*
  Usuarios y administraciones.
  - Cada administradora (fila de `administracion`) tiene sus operadores y sus consorcios; no ve los de las demás.
  - Invitar: crea el usuario y le manda un mail con un link para elegir contraseña (pasa por la función admin-usuarios).
  - Superadmin: ve todas las administraciones, puede crearlas y asignarles usuarios.
*/

type UsuarioFull = Usuario & { administracion_id: string | null; superadmin: boolean; administracion?: { nombre: string } | null };

export function Usuarios() {
  const { superadmin, administracionId, email: miEmail, rol: miRol } = useApp();
  const [tab, setTab] = useState('usuarios');
  const [items, setItems] = useState<UsuarioFull[]>([]);
  const [admins, setAdmins] = useState<(Administracion & { activa: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<UsuarioFull | null>(null);
  const [form, setForm] = useState({ nombre: '', email: '', rol: 'operador', activo: true, administracion_id: '', superadmin: false });
  const [deleteTarget, setDeleteTarget] = useState<UsuarioFull | null>(null);
  const [admModal, setAdmModal] = useState(false);
  const [admEdit, setAdmEdit] = useState<Administracion | null>(null);
  const [admForm, setAdmForm] = useState({ nombre: '', cuit: '', email: '', telefono: '', direccion: '', rpa: '', activa: true });

  const load = async () => {
    setLoading(true);
    const [u, a] = await Promise.all([
      supabase.from('usuarios').select('*, administracion(nombre)').order('nombre'),
      supabase.from('administracion').select('*').order('nombre'),
    ]);
    setItems((u.data as UsuarioFull[]) || []);
    setAdmins((a.data as typeof admins) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const llamar = async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/admin-usuarios`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string },
      body: JSON.stringify({ ...body, redirect: window.location.origin }),
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || d.error) throw new Error(d.error || (resp.status === 404 ? 'Falta deployar la función "admin-usuarios" en Supabase.' : `Error ${resp.status}`));
    return d as { ok: boolean; mensaje?: string };
  };

  const abrirNuevo = () => { setEditing(null); setForm({ nombre: '', email: '', rol: 'operador', activo: true, administracion_id: administracionId || '', superadmin: false }); setMsg(''); setModal(true); };
  const abrirEditar = (u: UsuarioFull) => { setEditing(u); setForm({ nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo, administracion_id: u.administracion_id || '', superadmin: u.superadmin }); setMsg(''); setModal(true); };

  const guardar = async () => {
    if (!form.nombre.trim() || !form.email.trim()) { setMsg('Error: nombre y mail son obligatorios.'); return; }
    setBusy(true); setMsg('');
    try {
      if (editing) {
        const payload: Record<string, unknown> = { nombre: form.nombre.trim(), rol: form.rol, activo: form.activo };
        if (superadmin) { payload.administracion_id = form.administracion_id || null; payload.superadmin = form.superadmin; }
        const { error } = await supabase.from('usuarios').update(payload).eq('id', editing.id);
        if (error) throw new Error(error.message);
        setMsg('Usuario actualizado.');
      } else {
        const r = await llamar({ accion: 'invitar', email: form.email.trim().toLowerCase(), nombre: form.nombre.trim(), rol: form.rol, administracion_id: form.administracion_id || undefined, superadmin: form.superadmin });
        setMsg(r.mensaje || 'Invitación enviada.');
      }
      setModal(false); load();
    } catch (e) { setMsg(`Error: ${(e as Error).message}`); }
    setBusy(false);
  };

  const eliminar = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try { await llamar({ accion: 'eliminar', email: deleteTarget.email }); setMsg(`${deleteTarget.email} eliminado.`); }
    catch (e) { setMsg(`Error: ${(e as Error).message}`); }
    setDeleteTarget(null); setBusy(false); load();
  };

  const guardarAdm = async () => {
    if (!admForm.nombre.trim()) { setMsg('Error: poné el nombre de la administración.'); return; }
    const payload = { nombre: admForm.nombre.trim(), cuit: admForm.cuit || null, email: admForm.email || null, telefono: admForm.telefono || null, direccion: admForm.direccion || null, rpa: admForm.rpa || null, activa: admForm.activa };
    const { error } = admEdit ? await supabase.from('administracion').update(payload).eq('id', admEdit.id) : await supabase.from('administracion').insert(payload);
    setMsg(error ? `Error: ${error.message}` : admEdit ? 'Administración actualizada.' : 'Administración creada. Ahora invitá a su primer usuario con rol Administrador.');
    if (!error) { setAdmModal(false); load(); }
  };

  const puedeGestionar = miRol === 'admin';
  const nombreAdm = (id: string | null) => admins.find((a) => a.id === id)?.nombre || '—';

  return (
    <div>
      <PageHeader title="Usuarios" subtitle={superadmin ? 'Todas las administraciones y sus operadores' : 'Operadores de tu administración'}
        action={puedeGestionar ? (tab === 'usuarios'
          ? <Button onClick={abrirNuevo}><Plus size={16} /> Invitar usuario</Button>
          : <Button onClick={() => { setAdmEdit(null); setAdmForm({ nombre: '', cuit: '', email: '', telefono: '', direccion: '', rpa: '', activa: true }); setAdmModal(true); }}><Plus size={16} /> Nueva administración</Button>) : null} />
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 mb-4 ${msg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div>}

      {superadmin && <Tabs active={tab} onChange={setTab} tabs={[{ key: 'usuarios', label: 'Usuarios', badge: items.length }, { key: 'administraciones', label: 'Administraciones', badge: admins.length }]} />}

      {tab === 'usuarios' && <Ayuda id="usuarios" titulo="Cómo funciona">
        <ul>
          <li><b>Invitar usuario</b>: le llega un mail con un link; al abrirlo elige su contraseña y ya entra. Si no le llega, que revise spam o usá "Olvidé mi contraseña" en el ingreso.</li>
          <li><b>Roles</b>: Administrador (todo, incluso invitar usuarios), Operador (carga y gestiona), Solo consulta (mira).</li>
          <li>Cada usuario ve únicamente los consorcios de su administración. {superadmin ? 'Vos sos superadmin: ves todas.' : ''}</li>
        </ul>
      </Ayuda>}

      {loading ? <Spinner /> : tab === 'usuarios' ? (
        items.length === 0 ? <Card><EmptyState icon={<UsersIcon size={28} />} title="Sin usuarios cargados" /></Card> : (
          <Card>
            <Table headers={['Nombre', 'Email', 'Rol', ...(superadmin ? ['Administración'] : []), 'Estado', '']}>
              {items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{u.nombre}{u.superadmin && <Badge color="purple">superadmin</Badge>}</Td>
                  <Td className="text-slate-500">{u.email}{u.email.toLowerCase() === miEmail && <span className="text-xs text-teal-600 ml-1">(vos)</span>}</Td>
                  <Td><Badge color={u.rol === 'admin' ? 'purple' : u.rol === 'operador' ? 'blue' : 'slate'}>{u.rol === 'admin' ? 'administrador' : u.rol === 'consulta' ? 'solo consulta' : u.rol}</Badge></Td>
                  {superadmin && <Td className="text-slate-500">{u.administracion?.nombre || nombreAdm(u.administracion_id)}</Td>}
                  <Td><Badge color={u.activo ? 'green' : 'slate'}>{u.activo ? 'activo' : 'inactivo'}</Badge></Td>
                  <Td>{puedeGestionar && <div className="flex gap-1">
                    <button onClick={() => abrirEditar(u)} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                    {u.email.toLowerCase() !== miEmail && (!u.superadmin || superadmin) && <button onClick={() => setDeleteTarget(u)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>}
                  </div>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )
      ) : (
        <>
          <Ayuda id="administraciones" titulo="Administraciones (sólo superadmin)">
            <p>Cada administradora es un espacio separado: sus consorcios, proveedores, comunicados y usuarios. Para dar de alta una nueva: creala acá y después invitá a su primer usuario con rol Administrador eligiendo esa administración; esa persona ya puede cargar consorcios e invitar a su gente.</p>
          </Ayuda>
          <Card>
            <Table headers={['Nombre', 'CUIT', 'Mail', 'Teléfono', 'RPA', 'Usuarios', 'Estado', '']}>
              {admins.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{a.nombre}</Td><Td className="font-mono text-xs">{a.cuit || '—'}</Td><Td className="text-slate-500">{a.email || '—'}</Td><Td>{a.telefono || '—'}</Td><Td>{a.rpa || '—'}</Td>
                  <Td>{items.filter((u) => u.administracion_id === a.id).length}</Td>
                  <Td><Badge color={a.activa ? 'green' : 'slate'}>{a.activa ? 'activa' : 'inactiva'}</Badge></Td>
                  <Td><button onClick={() => { setAdmEdit(a); setAdmForm({ nombre: a.nombre, cuit: a.cuit || '', email: a.email || '', telefono: a.telefono || '', direccion: a.direccion || '', rpa: a.rpa || '', activa: a.activa }); setAdmModal(true); }} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button></Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar usuario' : 'Invitar usuario'}>
        <div className="space-y-4">
          <Input label="Nombre" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} required />
          {editing ? <Input label="Email" value={form.email} onChange={() => {}} /> : <Input label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />}
          <Select label="Rol" value={form.rol} onChange={(v) => setForm({ ...form, rol: v })}
            options={[{ value: 'admin', label: 'Administrador' }, { value: 'operador', label: 'Operador' }, { value: 'consulta', label: 'Solo consulta' }]} />
          {superadmin && <>
            <Select label="Administración" value={form.administracion_id} onChange={(v) => setForm({ ...form, administracion_id: v })} placeholder="— Elegir —" options={admins.map((a) => ({ value: a.id, label: a.nombre }))} required />
            <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.superadmin} onChange={(e) => setForm({ ...form, superadmin: e.target.checked })} className="rounded" /> Superadmin (ve todas las administraciones)</label>
          </>}
          {editing && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="rounded" /> Activo</label>}
          {!editing && <p className="text-xs text-slate-400 flex items-start gap-1.5"><Mail size={13} className="mt-0.5 shrink-0" /> Le llega un mail con el link para elegir su contraseña. Si ya tenía cuenta (por ejemplo, como vecino del portal), entra con esa.</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={guardar} disabled={busy}>{busy ? 'Enviando…' : editing ? 'Guardar' : 'Invitar'}</Button>
        </div>
      </Modal>

      <Modal open={admModal} onClose={() => setAdmModal(false)} title={admEdit ? 'Editar administración' : 'Nueva administración'}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Input label="Nombre" value={admForm.nombre} onChange={(v) => setAdmForm({ ...admForm, nombre: v })} required /></div>
          <Input label="CUIT" value={admForm.cuit} onChange={(v) => setAdmForm({ ...admForm, cuit: v })} />
          <Input label="RPA (matrícula)" value={admForm.rpa} onChange={(v) => setAdmForm({ ...admForm, rpa: v })} />
          <Input label="Mail" value={admForm.email} onChange={(v) => setAdmForm({ ...admForm, email: v })} />
          <Input label="Teléfono" value={admForm.telefono} onChange={(v) => setAdmForm({ ...admForm, telefono: v })} />
          <div className="col-span-2"><Input label="Dirección" value={admForm.direccion} onChange={(v) => setAdmForm({ ...admForm, direccion: v })} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={admForm.activa} onChange={(e) => setAdmForm({ ...admForm, activa: e.target.checked })} className="rounded" /> Activa</label>
        </div>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setAdmModal(false)}>Cancelar</Button><Button onClick={guardarAdm}>Guardar</Button></div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar usuario" message={`¿Eliminar a ${deleteTarget?.nombre} (${deleteTarget?.email})? Deja de poder entrar a la app.`}
        onCancel={() => setDeleteTarget(null)} onConfirm={eliminar} />
    </div>
  );
}

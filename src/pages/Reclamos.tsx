import { useEffect, useState } from 'react';
import { ArrowLeft, History, Plus, Send, Wrench } from 'lucide-react';
import { supabase, type Proveedor, type Reclamo, type ReclamoEvento, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { fmtDate, hoyISO, notificar } from '@/lib/engine';

const categorias = ['plomeria', 'electricidad', 'estructura', 'limpieza', 'seguridad', 'ascensores', 'humedad', 'otro'];
const prioridades = ['baja', 'media', 'alta', 'urgente'];
const estados = ['abierto', 'en_proceso', 'presupuestado', 'resuelto', 'cerrado'];
const prioColor: Record<string, 'slate' | 'blue' | 'amber' | 'red'> = { baja: 'slate', media: 'blue', alta: 'amber', urgente: 'red' };
const estColor: Record<string, 'red' | 'amber' | 'purple' | 'green' | 'slate'> = { abierto: 'red', en_proceso: 'amber', presupuestado: 'purple', resuelto: 'green', cerrado: 'slate' };

export function Reclamos() {
  const { consorcio, usuario } = useApp();
  const [items, setItems] = useState<Reclamo[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<'abiertos' | 'cerrados'>('abiertos');
  const [busqueda, setBusqueda] = useState('');
  const [detalle, setDetalle] = useState<Reclamo | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ titulo: '', descripcion: '', unidad_id: '', categoria: 'otro', prioridad: 'media', proveedor_id: '', etiquetas: '' });

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [r, u, p] = await Promise.all([
      supabase.from('reclamos').select('*, unidades(*), proveedores(*)').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false }),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).order('uf'),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
    ]);
    setItems((r.data as Reclamo[]) || []);
    setUnidades((u.data as Unidad[]) || []);
    setProveedores((p.data as Proveedor[]) || []);
    setLoading(false);
  };
  useEffect(() => { setDetalle(null); load(); }, [consorcio?.id]);

  const abiertos = items.filter((r) => r.estado !== 'cerrado' && r.estado !== 'resuelto');
  const cerrados = items.filter((r) => r.estado === 'cerrado' || r.estado === 'resuelto');
  const visibles = (vista === 'abiertos' ? abiertos : cerrados)
    .filter((r) => !busqueda || r.titulo.toLowerCase().includes(busqueda.toLowerCase()) || (r.etiquetas || '').toLowerCase().includes(busqueda.toLowerCase()));

  const crear = async () => {
    if (!consorcio || !form.titulo.trim()) return;
    const { data, error } = await supabase.from('reclamos').insert({
      consorcio_id: consorcio.id, unidad_id: form.unidad_id || null, titulo: form.titulo.trim(),
      descripcion: form.descripcion || null, categoria: form.categoria, prioridad: form.prioridad,
      proveedor_id: form.proveedor_id || null, etiquetas: form.etiquetas || null,
    }).select().single();
    if (!error && data) {
      await supabase.from('reclamo_eventos').insert({ reclamo_id: data.id, tipo: 'cambio_estado', detalle: 'Reclamo creado (abierto)', autor: usuario });
      if (form.prioridad === 'urgente') await notificar('alerta', `Reclamo urgente: ${form.titulo}`, consorcio.nombre);
    }
    setModal(false);
    setForm({ titulo: '', descripcion: '', unidad_id: '', categoria: 'otro', prioridad: 'media', proveedor_id: '', etiquetas: '' });
    load();
  };

  if (!consorcio) return null;
  if (detalle) return <ReclamoDetalle reclamo={detalle} proveedores={proveedores} onBack={() => { setDetalle(null); load(); }} />;

  return (
    <div>
      <PageHeader title={`Reclamos · ${consorcio.nombre}`} subtitle="Mantenimiento y reclamos de vecinos, con historial de cada caso"
        action={<Button onClick={() => setModal(true)}><Plus size={16} /> Nuevo reclamo</Button>} />

      <Card className="p-4 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 max-w-sm"><Input value={busqueda} onChange={setBusqueda} placeholder="Título, etiqueta o seguidores" /></div>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <button onClick={() => setVista('abiertos')} className={vista === 'abiertos' ? 'text-teal-600' : 'text-slate-400'}>ABIERTOS ({abiertos.length})</button>
            <button onClick={() => setVista('cerrados')} className={vista === 'cerrados' ? 'text-teal-600' : 'text-slate-400'}>CERRADOS ({cerrados.length})</button>
          </div>
        </div>
      </Card>

      {loading ? <Spinner /> : visibles.length === 0 ? (
        <Card><EmptyState icon={<Wrench size={28} />} title={vista === 'abiertos' ? 'No se encontraron reclamos, ¡buen trabajo!' : 'Sin reclamos cerrados'} /></Card>
      ) : (
        <Card>
          <Table headers={['N°', 'Fecha', 'Título', 'UF', 'Categoría', 'Prioridad', 'Estado', 'Proveedor', '']}>
            {visibles.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetalle(r)}>
                <Td className="font-mono text-xs">#{r.numero}</Td>
                <Td>{fmtDate(r.created_at.slice(0, 10))}</Td>
                <Td className="font-medium max-w-xs truncate">{r.titulo}</Td>
                <Td>{r.unidades ? `UF ${r.unidades.uf}` : 'Común'}</Td>
                <Td className="capitalize text-slate-500">{r.categoria}</Td>
                <Td><Badge color={prioColor[r.prioridad]}>{r.prioridad}</Badge></Td>
                <Td><Badge color={estColor[r.estado]}>{r.estado.replace('_', ' ')}</Badge></Td>
                <Td className="text-slate-500">{r.proveedores?.nombre || '—'}</Td>
                <Td><span className="text-teal-600 text-xs font-medium">Abrir →</span></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Nuevo reclamo" size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><Input label="Título" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} required /></div>
          <div className="sm:col-span-2"><Textarea label="Descripción" value={form.descripcion} onChange={(v) => setForm({ ...form, descripcion: v })} /></div>
          <Select label="Unidad (vacío = espacio común)" value={form.unidad_id} onChange={(v) => setForm({ ...form, unidad_id: v })} placeholder="Espacio común"
            options={unidades.map((u) => ({ value: u.id, label: `UF ${u.uf} · ${u.depto}` }))} />
          <Select label="Categoría" value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })} options={categorias.map((c) => ({ value: c, label: c }))} />
          <Select label="Prioridad" value={form.prioridad} onChange={(v) => setForm({ ...form, prioridad: v })} options={prioridades.map((p) => ({ value: p, label: p }))} />
          <Select label="Proveedor asignado" value={form.proveedor_id} onChange={(v) => setForm({ ...form, proveedor_id: v })} placeholder="— Sin asignar —"
            options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} />
          <div className="sm:col-span-2"><Input label="Etiquetas" value={form.etiquetas} onChange={(v) => setForm({ ...form, etiquetas: v })} placeholder="terraza, caldera…" /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={crear}>Crear reclamo</Button>
        </div>
      </Modal>
    </div>
  );
}

function ReclamoDetalle({ reclamo, proveedores, onBack }: { reclamo: Reclamo; proveedores: Proveedor[]; onBack: () => void }) {
  const { usuario } = useApp();
  const [r, setR] = useState(reclamo);
  const [eventos, setEventos] = useState<ReclamoEvento[]>([]);
  const [comentario, setComentario] = useState('');
  const [loading, setLoading] = useState(true);

  const loadEventos = async () => {
    setLoading(true);
    const { data } = await supabase.from('reclamo_eventos').select('*').eq('reclamo_id', r.id).order('created_at');
    setEventos((data as ReclamoEvento[]) || []);
    setLoading(false);
  };
  useEffect(() => { loadEventos(); }, [r.id]);

  const cambiarEstado = async (estado: string) => {
    const payload: Record<string, unknown> = { estado };
    if (estado === 'resuelto' || estado === 'cerrado') payload.fecha_resolucion = hoyISO();
    await supabase.from('reclamos').update(payload).eq('id', r.id);
    await supabase.from('reclamo_eventos').insert({ reclamo_id: r.id, tipo: 'cambio_estado', detalle: `Estado cambiado a ${estado.replace('_', ' ')}`, autor: usuario });
    setR({ ...r, estado });
    loadEventos();
  };

  const asignarProveedor = async (proveedorId: string) => {
    await supabase.from('reclamos').update({ proveedor_id: proveedorId || null }).eq('id', r.id);
    const nombre = proveedores.find((p) => p.id === proveedorId)?.nombre;
    await supabase.from('reclamo_eventos').insert({ reclamo_id: r.id, tipo: 'comentario', detalle: nombre ? `Proveedor asignado: ${nombre}` : 'Proveedor desasignado', autor: usuario });
    setR({ ...r, proveedor_id: proveedorId || null });
    loadEventos();
  };

  const comentar = async () => {
    if (!comentario.trim()) return;
    await supabase.from('reclamo_eventos').insert({ reclamo_id: r.id, tipo: 'comentario', detalle: comentario.trim(), autor: usuario });
    setComentario('');
    loadEventos();
  };

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-teal-600 font-medium mb-3 hover:underline"><ArrowLeft size={15} /> Volver a reclamos</button>
      <PageHeader title={`#${r.numero} · ${r.titulo}`}
        subtitle={`${r.unidades ? `UF ${r.unidades.uf} · ${r.unidades.depto}` : 'Espacio común'} · ${r.categoria} · creado el ${fmtDate(r.created_at.slice(0, 10))}`}
        action={<Badge color={estColor[r.estado]}>{r.estado.replace('_', ' ')}</Badge>} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {r.descripcion && <Card className="p-4 text-sm text-slate-600 whitespace-pre-wrap">{r.descripcion}</Card>}
          <Card className="p-4">
            <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><History size={15} /> Historial</p>
            {loading ? <Spinner /> : (
              <div className="space-y-3">
                {eventos.map((e) => (
                  <div key={e.id} className="flex gap-3 text-sm">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${e.tipo === 'cambio_estado' ? 'bg-teal-400' : 'bg-slate-300'}`} />
                    <div>
                      <p className="text-slate-700">{e.detalle}</p>
                      <p className="text-xs text-slate-400">{e.autor || '—'} · {fmtDate(e.created_at.slice(0, 10))}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-4 pt-3 border-t border-slate-100">
              <input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Agregar comentario…"
                onKeyDown={(e) => e.key === 'Enter' && comentar()}
                className="flex-1 px-3.5 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
              <Button size="sm" onClick={comentar}><Send size={13} /></Button>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">Cambiar estado</p>
            <div className="flex flex-wrap gap-2">
              {estados.filter((e) => e !== r.estado).map((e) => (
                <Button key={e} size="sm" variant="secondary" onClick={() => cambiarEstado(e)}>{e.replace('_', ' ')}</Button>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <Select label="Proveedor asignado" value={r.proveedor_id || ''} onChange={asignarProveedor} placeholder="— Sin asignar —"
              options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} />
            <p className="text-xs text-slate-400 mt-2">Prioridad: <Badge color={prioColor[r.prioridad]}>{r.prioridad}</Badge></p>
            {r.etiquetas && <p className="text-xs text-slate-400 mt-2">Etiquetas: {r.etiquetas}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { CheckCircle2, Plus, Settings2, Trash2, Wrench } from 'lucide-react';
import { supabase, type Mantenimiento, type MantenimientoTipo, type Proveedor } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, hoyISO, notificar } from '@/lib/engine';

export function estadoMnt(vencimiento: string): { label: string; color: 'green' | 'amber' | 'red' } {
  const hoy = hoyISO();
  const en30 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (vencimiento < hoy) return { label: 'VENCIDO', color: 'red' };
  if (vencimiento <= en30) return { label: 'PRÓXIMO', color: 'amber' };
  return { label: 'VIGENTE', color: 'green' };
}

export function Mantenimientos() {
  const { consorcio, usuario } = useApp();
  const [items, setItems] = useState<Mantenimiento[]>([]);
  const [tipos, setTipos] = useState<MantenimientoTipo[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [tiposModal, setTiposModal] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState({ nombre: '', periodicidad_dias: '30' });
  const [form, setForm] = useState({ tipo_id: '', proveedor_id: '', descripcion: '', ultimo_mnt: '', vencimiento: '', recurrente: true, periodicidad_dias: '30' });
  const [deleteTarget, setDeleteTarget] = useState<Mantenimiento | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [m, t, p] = await Promise.all([
      supabase.from('mantenimientos').select('*, mantenimiento_tipos(*), proveedores(*)').eq('consorcio_id', consorcio.id).order('vencimiento'),
      supabase.from('mantenimiento_tipos').select('*').order('nombre'),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
    ]);
    setItems((m.data as Mantenimiento[]) || []);
    setTipos((t.data as MantenimientoTipo[]) || []);
    setProveedores((p.data as Proveedor[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const crear = async () => {
    if (!consorcio || !form.vencimiento) return;
    await supabase.from('mantenimientos').insert({
      consorcio_id: consorcio.id, tipo_id: form.tipo_id || null, proveedor_id: form.proveedor_id || null,
      descripcion: form.descripcion || null, ultimo_mnt: form.ultimo_mnt || null, vencimiento: form.vencimiento,
      recurrente: form.recurrente, periodicidad_dias: parseInt(form.periodicidad_dias) || 30,
    });
    setModal(false);
    setForm({ tipo_id: '', proveedor_id: '', descripcion: '', ultimo_mnt: '', vencimiento: '', recurrente: true, periodicidad_dias: '30' });
    load();
  };

  /** Regla: al registrar la realización, si es recurrente se renueva el vencimiento según la periodicidad. */
  const registrarRealizado = async (m: Mantenimiento) => {
    const hoy = hoyISO();
    if (m.recurrente) {
      const prox = new Date(Date.now() + m.periodicidad_dias * 24 * 3600 * 1000).toISOString().slice(0, 10);
      await supabase.from('mantenimientos').update({ ultimo_mnt: hoy, vencimiento: prox }).eq('id', m.id);
      await notificar('info', `Mantenimiento realizado: ${m.mantenimiento_tipos?.nombre || m.descripcion}`, `${usuario} lo registró. Próximo vencimiento ${fmtDate(prox)}.`);
    } else {
      await supabase.from('mantenimientos').delete().eq('id', m.id);
    }
    load();
  };

  const crearTipo = async () => {
    if (!nuevoTipo.nombre.trim()) return;
    await supabase.from('mantenimiento_tipos').insert({ nombre: nuevoTipo.nombre.trim(), periodicidad_dias: parseInt(nuevoTipo.periodicidad_dias) || 30 });
    setNuevoTipo({ nombre: '', periodicidad_dias: '30' });
    load();
  };

  if (!consorcio) return null;

  return (
    <div>
      <PageHeader title={`Mantenimientos y controles · ${consorcio.nombre}`} subtitle="Controles obligatorios con vencimiento (ascensores, matafuegos, tanques, fumigación)"
        action={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => setTiposModal(true)}><Settings2 size={15} /> Tipos</Button>
          <Button onClick={() => setModal(true)}><Plus size={16} /> Nuevo</Button>
        </div>} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<Wrench size={28} />} title="No hay registros" subtitle="Cargá los controles del edificio para no perder ningún vencimiento." /></Card>
      ) : (
        <Card>
          <Table headers={['Tipo', 'Descripción', 'Proveedor', 'Último mnt.', 'Vencimiento', 'Estado', '']}>
            {items.map((m) => {
              const est = estadoMnt(m.vencimiento);
              return (
                <tr key={m.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{m.mantenimiento_tipos?.nombre || '—'}</Td>
                  <Td className="text-slate-500 max-w-xs truncate">{m.descripcion || '—'}</Td>
                  <Td className="text-slate-500">{m.proveedores?.nombre || '—'}</Td>
                  <Td>{fmtDate(m.ultimo_mnt)}</Td>
                  <Td className="font-medium">{fmtDate(m.vencimiento)}</Td>
                  <Td><Badge color={est.color}>{est.label}</Badge>{m.recurrente && <span className="text-[10px] text-slate-400 ml-1.5">cada {m.periodicidad_dias}d</span>}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => registrarRealizado(m)}><CheckCircle2 size={13} /> Realizado</Button>
                      <button onClick={() => setDeleteTarget(m)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Nuevo mantenimiento / control">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="Tipo" value={form.tipo_id} onChange={(v) => {
            const t = tipos.find((x) => x.id === v);
            setForm({ ...form, tipo_id: v, periodicidad_dias: t ? String(t.periodicidad_dias) : form.periodicidad_dias });
          }} placeholder="— Elegir —" options={tipos.map((t) => ({ value: t.id, label: t.nombre }))} />
          <Select label="Proveedor" value={form.proveedor_id} onChange={(v) => setForm({ ...form, proveedor_id: v })} placeholder="— Sin asignar —"
            options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} />
          <div className="sm:col-span-2"><Input label="Descripción" value={form.descripcion} onChange={(v) => setForm({ ...form, descripcion: v })} /></div>
          <Input label="Último mantenimiento" type="date" value={form.ultimo_mnt} onChange={(v) => setForm({ ...form, ultimo_mnt: v })} />
          <Input label="Próximo vencimiento" type="date" value={form.vencimiento} onChange={(v) => setForm({ ...form, vencimiento: v })} required />
          <Input label="Periodicidad (días)" type="number" value={form.periodicidad_dias} onChange={(v) => setForm({ ...form, periodicidad_dias: v })} />
          <label className="flex items-center gap-2 text-sm text-slate-600 pt-6">
            <input type="checkbox" checked={form.recurrente} onChange={(e) => setForm({ ...form, recurrente: e.target.checked })} className="rounded" />
            Recurrente (se renueva al registrarlo)
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={crear} disabled={!form.vencimiento}>Guardar</Button>
        </div>
      </Modal>

      <Modal open={tiposModal} onClose={() => setTiposModal(false)} title="Tipos de mantenimiento">
        <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
          {tipos.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
              <span>{t.nombre}</span>
              <span className="text-xs text-slate-400">cada {t.periodicidad_dias} días</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1"><Input label="Nuevo tipo" value={nuevoTipo.nombre} onChange={(v) => setNuevoTipo({ ...nuevoTipo, nombre: v })} /></div>
          <div className="w-28"><Input label="Días" type="number" value={nuevoTipo.periodicidad_dias} onChange={(v) => setNuevoTipo({ ...nuevoTipo, periodicidad_dias: v })} /></div>
          <Button onClick={crearTipo}>Agregar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar registro" message="¿Eliminar este mantenimiento del listado?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('mantenimientos').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

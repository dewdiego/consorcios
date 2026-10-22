import { useEffect, useState } from 'react';
import { Megaphone, Pin, Plus, Trash2 } from 'lucide-react';
import { supabase, type Comunicado } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, hoyISO } from '@/lib/engine';

const tipoColor: Record<string, 'slate' | 'red' | 'amber' | 'purple' | 'blue'> = {
  general: 'slate', urgente: 'red', mantenimiento: 'amber', asamblea: 'purple', administrativo: 'blue',
};

export function Noticias() {
  const { consorcio, consorcios } = useApp();
  const [tab, setTab] = useState('comunicados');
  const [items, setItems] = useState<Comunicado[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ consorcio_id: '', tipo: 'general', titulo: '', contenido: '', fecha_publicacion: hoyISO(), fijado: false });
  const [deleteTarget, setDeleteTarget] = useState<Comunicado | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('comunicados').select('*, consorcios(*)').eq('activo', true)
      .order('fijado', { ascending: false }).order('fecha_publicacion', { ascending: false });
    setItems((data as Comunicado[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const visibles = items.filter((c) => c.seccion === tab)
    .filter((c) => !consorcio || !c.consorcio_id || c.consorcio_id === consorcio.id);

  const crear = async () => {
    if (!form.titulo.trim() || !form.contenido.trim()) return;
    await supabase.from('comunicados').insert({
      consorcio_id: form.consorcio_id || null, seccion: tab, tipo: form.tipo,
      titulo: form.titulo.trim(), contenido: form.contenido.trim(),
      fecha_publicacion: form.fecha_publicacion, fijado: form.fijado,
    });
    setModal(false);
    setForm({ consorcio_id: '', tipo: 'general', titulo: '', contenido: '', fecha_publicacion: hoyISO(), fijado: false });
    load();
  };

  const toggleFijado = async (c: Comunicado) => {
    await supabase.from('comunicados').update({ fijado: !c.fijado }).eq('id', c.id);
    load();
  };

  return (
    <div>
      <PageHeader title="Noticias" subtitle={consorcio ? `Mostrando publicaciones generales y de ${consorcio.nombre}` : 'Publicaciones de todos los consorcios'}
        action={<Button onClick={() => { setForm((f) => ({ ...f, consorcio_id: consorcio?.id || '' })); setModal(true); }}><Plus size={16} /> Nueva publicación</Button>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'novedades', label: 'Novedades', badge: items.filter((i) => i.seccion === 'novedades').length },
        { key: 'comunicados', label: 'Comunicados', badge: items.filter((i) => i.seccion === 'comunicados').length },
        { key: 'muro', label: 'Muro', badge: items.filter((i) => i.seccion === 'muro').length },
      ]} />

      {loading ? <Spinner /> : visibles.length === 0 ? (
        <Card><EmptyState icon={<Megaphone size={28} />} title={`Sin publicaciones en ${tab}`} /></Card>
      ) : (
        <div className="space-y-3">
          {visibles.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.fijado && <Pin size={13} className="text-teal-500" />}
                    <p className="font-semibold text-slate-800">{c.titulo}</p>
                    <Badge color={tipoColor[c.tipo] || 'slate'}>{c.tipo}</Badge>
                    {!c.consorcio_id ? <Badge color="teal">todos</Badge> : <Badge color="blue">{c.consorcios?.nombre}</Badge>}
                  </div>
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{c.contenido}</p>
                  <p className="text-xs text-slate-400 mt-2">{fmtDate(c.fecha_publicacion)}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => toggleFijado(c)} className={`p-1.5 rounded ${c.fijado ? 'text-teal-500 bg-teal-50' : 'text-slate-300 hover:bg-slate-100'}`} title="Fijar"><Pin size={14} /></button>
                  <button onClick={() => setDeleteTarget(c)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={`Nueva publicación en ${tab}`} size="lg">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Select label="Consorcio" value={form.consorcio_id} onChange={(v) => setForm({ ...form, consorcio_id: v })} placeholder="Todos los consorcios"
            options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} />
          <Select label="Tipo" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })}
            options={Object.keys(tipoColor).map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))} />
        </div>
        <div className="space-y-4">
          <Input label="Título" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} required />
          <Textarea label="Contenido" value={form.contenido} onChange={(v) => setForm({ ...form, contenido: v })} rows={5} required />
          <div className="grid grid-cols-2 gap-4 items-end">
            <Input label="Fecha de publicación" type="date" value={form.fecha_publicacion} onChange={(v) => setForm({ ...form, fecha_publicacion: v })} />
            <label className="flex items-center gap-2 text-sm text-slate-600 pb-2.5">
              <input type="checkbox" checked={form.fijado} onChange={(e) => setForm({ ...form, fijado: e.target.checked })} className="rounded" /> Fijar arriba
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={crear}>Publicar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar publicación" message={`¿Eliminar "${deleteTarget?.titulo}"?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('comunicados').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Lock, Plus, Trash2, Vote } from 'lucide-react';
import { supabase, type Encuesta, type EncuestaOpcion } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate } from '@/lib/engine';

export function Encuestas() {
  const { consorcio } = useApp();
  const [items, setItems] = useState<Encuesta[]>([]);
  const [opciones, setOpciones] = useState<EncuestaOpcion[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ titulo: '', descripcion: '', fecha_cierre: '', opciones: ['', ''] });
  const [deleteTarget, setDeleteTarget] = useState<Encuesta | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const { data: es } = await supabase.from('encuestas').select('*').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false });
    const list = (es as Encuesta[]) || [];
    setItems(list);
    if (list.length) {
      const { data: ops } = await supabase.from('encuesta_opciones').select('*').in('encuesta_id', list.map((e) => e.id));
      setOpciones((ops as EncuestaOpcion[]) || []);
    } else setOpciones([]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const crear = async () => {
    if (!consorcio || !form.titulo.trim()) return;
    const ops = form.opciones.map((o) => o.trim()).filter(Boolean);
    if (ops.length < 2) return;
    const { data: enc, error } = await supabase.from('encuestas').insert({
      consorcio_id: consorcio.id, titulo: form.titulo.trim(), descripcion: form.descripcion || null, fecha_cierre: form.fecha_cierre || null,
    }).select().single();
    if (!error && enc) {
      await supabase.from('encuesta_opciones').insert(ops.map((texto) => ({ encuesta_id: enc.id, texto })));
    }
    setModal(false);
    setForm({ titulo: '', descripcion: '', fecha_cierre: '', opciones: ['', ''] });
    load();
  };

  const votar = async (op: EncuestaOpcion) => {
    await supabase.from('encuesta_opciones').update({ votos: op.votos + 1 }).eq('id', op.id);
    load();
  };

  const cerrarEnc = async (e: Encuesta) => {
    await supabase.from('encuestas').update({ estado: 'cerrada' }).eq('id', e.id);
    load();
  };

  if (!consorcio) return null;

  return (
    <div>
      <PageHeader title={`Encuestas · ${consorcio.nombre}`} subtitle="Votaciones de propietarios (la administración registra los votos recibidos)"
        action={<Button onClick={() => setModal(true)}><Plus size={16} /> Nueva encuesta</Button>} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<Vote size={28} />} title="Sin encuestas" /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((e) => {
            const ops = opciones.filter((o) => o.encuesta_id === e.id);
            const total = ops.reduce((a, o) => a + o.votos, 0);
            return (
              <Card key={e.id} className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-800">{e.titulo}</p>
                    {e.descripcion && <p className="text-sm text-slate-500 mt-0.5">{e.descripcion}</p>}
                    <p className="text-xs text-slate-400 mt-1">{total} votos{e.fecha_cierre ? ` · cierra ${fmtDate(e.fecha_cierre)}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge color={e.estado === 'abierta' ? 'green' : 'slate'}>{e.estado}</Badge>
                    {e.estado === 'abierta' && <button onClick={() => cerrarEnc(e)} className="p-1.5 rounded text-slate-400 hover:bg-slate-100" title="Cerrar"><Lock size={14} /></button>}
                    <button onClick={() => setDeleteTarget(e)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="space-y-2.5 mt-4">
                  {ops.map((o) => {
                    const pct = total > 0 ? (o.votos / total) * 100 : 0;
                    return (
                      <div key={o.id}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-slate-600">{o.texto}</span>
                          <span className="text-slate-400">{o.votos} ({Math.round(pct)}%)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                          {e.estado === 'abierta' && <Button size="sm" variant="ghost" onClick={() => votar(o)}>+1</Button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Nueva encuesta">
        <div className="space-y-4">
          <Input label="Pregunta / título" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} required />
          <Textarea label="Descripción" value={form.descripcion} onChange={(v) => setForm({ ...form, descripcion: v })} rows={2} />
          <Input label="Fecha de cierre" type="date" value={form.fecha_cierre} onChange={(v) => setForm({ ...form, fecha_cierre: v })} />
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Opciones (mínimo 2)</label>
            <div className="space-y-2">
              {form.opciones.map((o, i) => (
                <input key={i} value={o} onChange={(e) => {
                  const ops = [...form.opciones]; ops[i] = e.target.value; setForm({ ...form, opciones: ops });
                }} placeholder={`Opción ${i + 1}`}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
              ))}
            </div>
            <button onClick={() => setForm({ ...form, opciones: [...form.opciones, ''] })} className="text-xs text-teal-600 font-medium mt-2 hover:underline">+ Agregar opción</button>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={crear}>Crear</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar encuesta" message={`¿Eliminar "${deleteTarget?.titulo}" con sus votos?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('encuestas').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

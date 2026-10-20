import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { supabase, type Evento } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Button, Card, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { hoyISO } from '@/lib/engine';

type Item = { fecha: string; titulo: string; tipo: string; origen: 'evento' | 'liquidacion' | 'mantenimiento' | 'certificacion'; id?: string };

const tipoColor: Record<string, string> = {
  asamblea: 'bg-purple-100 text-purple-700', vencimiento: 'bg-red-100 text-red-700',
  visita: 'bg-blue-100 text-blue-700', recordatorio: 'bg-amber-100 text-amber-700',
  otro: 'bg-slate-100 text-slate-600',
  liquidacion: 'bg-teal-100 text-teal-700', mantenimiento: 'bg-orange-100 text-orange-700', certificacion: 'bg-pink-100 text-pink-700',
};

/** Calendario mensual: eventos manuales + vencimientos automáticos (expensas, mantenimientos, certificaciones). */
export function Calendario() {
  const { consorcio, consorcios } = useApp();
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ consorcio_id: '', titulo: '', tipo: 'recordatorio', fecha: hoyISO(), hora: '', notas: '' });

  const desde = `${mes}-01`;
  const hasta = `${mes}-31`;

  const load = async () => {
    setLoading(true);
    const [ev, liq, mnt, cert] = await Promise.all([
      supabase.from('eventos').select('*, consorcios(nombre)').gte('fecha', desde).lte('fecha', hasta),
      supabase.from('liquidaciones').select('periodo, fecha_vencimiento_1, fecha_vencimiento_2, consorcios(nombre)').gte('fecha_vencimiento_1', desde).lte('fecha_vencimiento_1', hasta),
      supabase.from('mantenimientos').select('vencimiento, descripcion, mantenimiento_tipos(nombre), consorcios(nombre)').gte('vencimiento', desde).lte('vencimiento', hasta),
      supabase.from('proveedor_certificaciones').select('vencimiento, requerimiento, proveedores(nombre)').gte('vencimiento', desde).lte('vencimiento', hasta),
    ]);
    const out: Item[] = [];
    for (const e of (ev.data as (Evento & { consorcios: { nombre: string } | null })[]) || []) {
      out.push({ fecha: e.fecha, titulo: `${e.titulo}${e.consorcios ? ` (${e.consorcios.nombre})` : ''}`, tipo: e.tipo, origen: 'evento', id: e.id });
    }
    for (const l of (liq.data as unknown as { periodo: string; fecha_vencimiento_1: string; consorcios: { nombre: string } | null }[]) || []) {
      out.push({ fecha: l.fecha_vencimiento_1, titulo: `Venc. expensas ${l.periodo} ${l.consorcios?.nombre || ''}`, tipo: 'liquidacion', origen: 'liquidacion' });
    }
    for (const m of (mnt.data as unknown as { vencimiento: string; descripcion: string | null; mantenimiento_tipos: { nombre: string } | null; consorcios: { nombre: string } | null }[]) || []) {
      out.push({ fecha: m.vencimiento, titulo: `${m.mantenimiento_tipos?.nombre || m.descripcion || 'Mantenimiento'} · ${m.consorcios?.nombre || ''}`, tipo: 'mantenimiento', origen: 'mantenimiento' });
    }
    for (const c of (cert.data as unknown as { vencimiento: string; requerimiento: string; proveedores: { nombre: string } | null }[]) || []) {
      out.push({ fecha: c.vencimiento, titulo: `Vence ${c.requerimiento} · ${c.proveedores?.nombre || ''}`, tipo: 'certificacion', origen: 'certificacion' });
    }
    setItems(out.filter((i) => !consorcio || !i.titulo || true)); // todos; el filtro visual es por color
    setLoading(false);
  };
  useEffect(() => { load(); }, [mes]);

  const dias = useMemo(() => {
    const [y, m] = mes.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const startOffset = (first.getDay() + 6) % 7; // lunes = 0
    const cells: (string | null)[] = Array(startOffset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${mes}-${String(d).padStart(2, '0')}`);
    return cells;
  }, [mes]);

  const cambiarMes = (delta: number) => {
    const [y, m] = mes.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const crear = async () => {
    if (!form.titulo.trim() || !form.fecha) return;
    await supabase.from('eventos').insert({
      consorcio_id: form.consorcio_id || null, titulo: form.titulo.trim(), tipo: form.tipo,
      fecha: form.fecha, hora: form.hora || null, notas: form.notas || null,
    });
    setModal(false);
    setForm({ consorcio_id: '', titulo: '', tipo: 'recordatorio', fecha: hoyISO(), hora: '', notas: '' });
    load();
  };

  const nombreMes = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1)
    .toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  return (
    <div>
      <PageHeader title="Calendario" subtitle="Eventos, asambleas y vencimientos automáticos (expensas, mantenimientos, certificaciones)"
        action={<div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => cambiarMes(-1)}><ChevronLeft size={16} /></Button>
          <span className="text-sm font-semibold text-slate-700 capitalize w-40 text-center">{nombreMes}</span>
          <Button variant="ghost" size="sm" onClick={() => cambiarMes(1)}><ChevronRight size={16} /></Button>
          <Button onClick={() => setModal(true)}><Plus size={16} /> Evento</Button>
        </div>} />

      {loading ? <Spinner /> : (
        <Card className="p-4">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400 uppercase mb-1">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {dias.map((fecha, i) => (
              <div key={i} className={`min-h-[86px] rounded-lg border p-1.5 ${fecha ? (fecha === hoyISO() ? 'border-teal-400 bg-teal-50/40' : 'border-slate-100 bg-white') : 'border-transparent'}`}>
                {fecha && <>
                  <p className="text-[11px] font-semibold text-slate-400 mb-1">{Number(fecha.slice(8, 10))}</p>
                  <div className="space-y-0.5">
                    {items.filter((it) => it.fecha === fecha).slice(0, 4).map((it, j) => (
                      <p key={j} title={it.titulo} className={`text-[10px] px-1.5 py-0.5 rounded truncate ${tipoColor[it.tipo] || tipoColor.otro}`}>{it.titulo}</p>
                    ))}
                    {items.filter((it) => it.fecha === fecha).length > 4 && <p className="text-[10px] text-slate-400">+{items.filter((it) => it.fecha === fecha).length - 4} más</p>}
                  </div>
                </>}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-teal-200 mr-1" />Venc. expensas</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-200 mr-1" />Mantenimientos</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-pink-200 mr-1" />Certificaciones</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-200 mr-1" />Asambleas</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-200 mr-1" />Recordatorios</span>
          </div>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Nuevo evento">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Input label="Título" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} required /></div>
          <Select label="Consorcio" value={form.consorcio_id} onChange={(v) => setForm({ ...form, consorcio_id: v })} placeholder="— General —"
            options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} />
          <Select label="Tipo" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })}
            options={[{ value: 'asamblea', label: 'Asamblea' }, { value: 'visita', label: 'Visita' }, { value: 'vencimiento', label: 'Vencimiento' }, { value: 'recordatorio', label: 'Recordatorio' }, { value: 'otro', label: 'Otro' }]} />
          <Input label="Fecha" type="date" value={form.fecha} onChange={(v) => setForm({ ...form, fecha: v })} required />
          <Input label="Hora" type="time" value={form.hora} onChange={(v) => setForm({ ...form, hora: v })} />
          <div className="col-span-2"><Textarea label="Notas" value={form.notas} onChange={(v) => setForm({ ...form, notas: v })} rows={2} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={crear}>Guardar</Button>
        </div>
      </Modal>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Pencil, Plus, Send, Trash2, Video } from 'lucide-react';
import { supabase, type Reunion, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { fmtDate, hoyISO } from '@/lib/engine';
import { encolarAviso, mailHtml } from '@/lib/avisos';
import { escHtml } from '@/lib/imprimir';

const PLAT: Record<Reunion['plataforma'], string> = { meet: 'Google Meet', zoom: 'Zoom', otra: 'Otra plataforma', presencial: 'Presencial' };

/** Reuniones y asambleas: se arma la convocatoria con el link de Meet o Zoom y se avisa a los vecinos por mail y app. */
export function Reuniones() {
  const { consorcio } = useApp();
  const [items, setItems] = useState<Reunion[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const vacio = { id: '', titulo: '', descripcion: '', fecha: hoyISO(), hora: '19:00', plataforma: 'meet', link: '', destinatarios: 'propietarios' };
  const [form, setForm] = useState<typeof vacio | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const { data } = await supabase.from('reuniones').select('*').eq('consorcio_id', consorcio.id).order('fecha', { ascending: false });
    setItems((data as Reunion[]) || []); setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const guardar = async () => {
    if (!consorcio || !form) return;
    if (!form.titulo.trim()) return setMsg('Poné el título de la reunión.');
    if (form.plataforma !== 'presencial' && !/^https?:\/\//i.test(form.link.trim())) return setMsg('Pegá el link de la reunión (empieza con https://).');
    const fila = { consorcio_id: consorcio.id, titulo: form.titulo.trim(), descripcion: form.descripcion || null, fecha: form.fecha, hora: form.hora, plataforma: form.plataforma, link: form.link.trim() || null, destinatarios: form.destinatarios };
    const { error } = form.id ? await supabase.from('reuniones').update(fila).eq('id', form.id) : await supabase.from('reuniones').insert(fila);
    if (error) return setMsg(error.message);
    setForm(null); setMsg(''); load();
  };
  const avisar = async (r: Reunion) => {
    if (!consorcio) return;
    const { data } = await supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true);
    const cuerpo = `<p>Lo convocamos a la siguiente reunión:</p>
      <table style="font-size:14px;border-collapse:collapse"><tr><td style="padding:3px 10px 3px 0;color:#64748b">Fecha</td><td><b>${fmtDate(r.fecha)} a las ${escHtml(r.hora)} hs</b></td></tr>
      <tr><td style="padding:3px 10px 3px 0;color:#64748b">Modalidad</td><td>${PLAT[r.plataforma]}</td></tr></table>
      ${r.descripcion ? `<p style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:8px">${escHtml(r.descripcion)}</p>` : ''}`;
    try {
      const n = await encolarAviso(consorcio, (data as Unidad[]) || [], `Convocatoria: ${r.titulo} - ${consorcio.nombre}`, mailHtml(r.titulo, consorcio.nombre, cuerpo, r.link ? { texto: 'Entrar a la reunión', url: r.link } : undefined), `${r.titulo}: ${fmtDate(r.fecha)} ${r.hora} hs`, r.destinatarios === 'todos' ? 'todos' : 'propietarios');
      await supabase.from('reuniones').update({ notificada_at: new Date().toISOString() }).eq('id', r.id);
      setMsg(`Convocatoria encolada para ${n} destinatario(s). Sale con el próximo procesamiento de Envíos de mail.`); load();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  if (!consorcio) return null;
  return (
    <div>
      <PageHeader title={`Reuniones · ${consorcio.nombre}`} subtitle="Convocatorias a asambleas y reuniones por Meet, Zoom o presenciales"
        action={<Button onClick={() => { setMsg(''); setForm(vacio); }}><Plus size={16} /> Nueva reunión</Button>} />
      {msg && <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 mb-4">{msg}</p>}
      {loading ? <Spinner /> : items.length === 0 ? <Card><EmptyState icon={<Video size={28} />} title="Sin reuniones" subtitle="Creá la reunión en Meet o Zoom, pegá el link acá y el sistema manda la convocatoria." /></Card> : (
        <Card><Table headers={['Fecha', 'Reunión', 'Modalidad', 'Convocatoria', '']}>
          {items.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <Td className="font-medium">{fmtDate(r.fecha)} · {r.hora}</Td>
              <Td>{r.titulo}{r.link && <a href={r.link} target="_blank" rel="noreferrer" className="block text-xs text-teal-600 underline truncate max-w-xs">{r.link}</a>}</Td>
              <Td>{PLAT[r.plataforma]}</Td>
              <Td>{r.notificada_at ? <Badge color="green">ENVIADA {fmtDate(r.notificada_at)}</Badge> : <Badge color="amber">SIN ENVIAR</Badge>}</Td>
              <Td><div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => avisar(r)}><Send size={13} /> {r.notificada_at ? 'Reenviar' : 'Convocar'}</Button>
                <button title="Editar" onClick={() => setForm({ id: r.id, titulo: r.titulo, descripcion: r.descripcion || '', fecha: r.fecha, hora: r.hora, plataforma: r.plataforma, link: r.link || '', destinatarios: r.destinatarios })} className="p-1.5 rounded text-slate-500 hover:bg-slate-100"><Pencil size={14} /></button>
                <button title="Eliminar" onClick={async () => { await supabase.from('reuniones').delete().eq('id', r.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
              </div></Td>
            </tr>
          ))}
        </Table></Card>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar reunión' : 'Nueva reunión'}>
        {form && <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><Input label="Título" required value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} placeholder="Asamblea ordinaria" /></div>
            <Input label="Fecha" type="date" value={form.fecha} onChange={(v) => setForm({ ...form, fecha: v })} />
            <Input label="Hora" type="time" value={form.hora} onChange={(v) => setForm({ ...form, hora: v })} />
            <Select label="Modalidad" value={form.plataforma} onChange={(v) => setForm({ ...form, plataforma: v })} options={Object.entries(PLAT).map(([value, label]) => ({ value, label }))} />
            <Select label="Convocar a" value={form.destinatarios} onChange={(v) => setForm({ ...form, destinatarios: v })} options={[{ value: 'propietarios', label: 'Propietarios' }, { value: 'todos', label: 'Propietarios e inquilinos' }]} />
            {form.plataforma !== 'presencial' && <div className="sm:col-span-2"><Input label="Link de la reunión" value={form.link} onChange={(v) => setForm({ ...form, link: v })} placeholder="https://meet.google.com/..." /></div>}
            <div className="sm:col-span-2"><Textarea label="Orden del día / detalle" value={form.descripcion} onChange={(v) => setForm({ ...form, descripcion: v })} rows={4} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={guardar}>Guardar</Button></div>
        </>}
      </Modal>
    </div>
  );
}

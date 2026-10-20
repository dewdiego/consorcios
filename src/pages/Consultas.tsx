import { useEffect, useState } from 'react';
import { CheckCircle2, HelpCircle, Plus, Reply } from 'lucide-react';
import { supabase, type Consulta, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { fmtDate } from '@/lib/engine';

const destinatarios = [
  { value: 'administracion', label: 'Administración' },
  { value: 'encargado', label: 'Encargado' },
  { value: 'consejo', label: 'Consejo de propietarios' },
];

export function Consultas() {
  const { consorcio } = useApp();
  const [items, setItems] = useState<Consulta[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [fId, setFId] = useState('');
  const [fEstado, setFEstado] = useState('abierta');
  const [fUnidad, setFUnidad] = useState('');
  const [fDest, setFDest] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ unidad_id: '', destinatario: 'administracion', asunto: '', mensaje: '' });
  const [respondiendo, setRespondiendo] = useState<Consulta | null>(null);
  const [respuesta, setRespuesta] = useState('');

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [c, u] = await Promise.all([
      supabase.from('consultas').select('*, unidades(*)').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false }),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).order('uf'),
    ]);
    setItems((c.data as Consulta[]) || []);
    setUnidades((u.data as Unidad[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const visibles = items
    .filter((c) => !fId || String(c.numero).includes(fId))
    .filter((c) => !fEstado || c.estado === fEstado)
    .filter((c) => !fUnidad || c.unidad_id === fUnidad)
    .filter((c) => !fDest || c.destinatario === fDest);

  const crear = async () => {
    if (!consorcio || !form.asunto.trim()) return;
    await supabase.from('consultas').insert({
      consorcio_id: consorcio.id, unidad_id: form.unidad_id || null,
      destinatario: form.destinatario, asunto: form.asunto.trim(), mensaje: form.mensaje || null,
    });
    setModal(false);
    setForm({ unidad_id: '', destinatario: 'administracion', asunto: '', mensaje: '' });
    load();
  };

  const responder = async () => {
    if (!respondiendo || !respuesta.trim()) return;
    await supabase.from('consultas').update({ estado: 'respondida', respuesta: respuesta.trim(), respondida_at: new Date().toISOString() }).eq('id', respondiendo.id);
    setRespondiendo(null); setRespuesta('');
    load();
  };

  const cerrar = async (c: Consulta) => {
    await supabase.from('consultas').update({ estado: 'cerrada' }).eq('id', c.id);
    load();
  };

  if (!consorcio) return null;

  return (
    <div>
      <PageHeader title={`Consultas · ${consorcio.nombre}`} subtitle="Mesa de entradas de los vecinos"
        action={<Button onClick={() => setModal(true)}><Plus size={16} /> Nueva consulta</Button>} />

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap gap-3">
          <div className="w-32"><Input label="Identificador" value={fId} onChange={setFId} placeholder="N°" /></div>
          <div className="w-40"><Select label="Estado" value={fEstado} onChange={setFEstado} placeholder="Todos"
            options={[{ value: 'abierta', label: 'Abierta' }, { value: 'respondida', label: 'Respondida' }, { value: 'cerrada', label: 'Cerrada' }]} /></div>
          <div className="w-48"><Select label="Unidad" value={fUnidad} onChange={setFUnidad} placeholder="Todas"
            options={unidades.map((u) => ({ value: u.id, label: `UF ${u.uf} · ${u.depto}` }))} /></div>
          <div className="w-48"><Select label="Destinatario" value={fDest} onChange={setFDest} placeholder="Todos" options={destinatarios} /></div>
        </div>
      </Card>

      {loading ? <Spinner /> : visibles.length === 0 ? (
        <Card><EmptyState icon={<HelpCircle size={28} />} title="No hay consultas para el criterio buscado." /></Card>
      ) : (
        <Card>
          <Table headers={['N°', 'Fecha', 'UF', 'Destinatario', 'Asunto', 'Estado', '']}>
            {visibles.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">#{c.numero}</Td>
                <Td>{fmtDate(c.created_at.slice(0, 10))}</Td>
                <Td>{c.unidades ? `UF ${c.unidades.uf}` : '—'}</Td>
                <Td className="capitalize text-slate-500">{c.destinatario}</Td>
                <Td className="font-medium max-w-md">
                  {c.asunto}
                  {c.mensaje && <span className="block text-xs text-slate-400 truncate">{c.mensaje}</span>}
                  {c.respuesta && <span className="block text-xs text-teal-600 mt-0.5">↳ {c.respuesta}</span>}
                </Td>
                <Td><Badge color={c.estado === 'abierta' ? 'amber' : c.estado === 'respondida' ? 'green' : 'slate'}>{c.estado}</Badge></Td>
                <Td>
                  <div className="flex gap-1">
                    {c.estado === 'abierta' && <Button size="sm" variant="secondary" onClick={() => { setRespondiendo(c); setRespuesta(''); }}><Reply size={13} /> Responder</Button>}
                    {c.estado !== 'cerrada' && <Button size="sm" variant="ghost" onClick={() => cerrar(c)}><CheckCircle2 size={13} /> Cerrar</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Nueva consulta">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Unidad" value={form.unidad_id} onChange={(v) => setForm({ ...form, unidad_id: v })} placeholder="— Sin UF —"
            options={unidades.map((u) => ({ value: u.id, label: `UF ${u.uf} · ${u.depto}` }))} />
          <Select label="Destinatario" value={form.destinatario} onChange={(v) => setForm({ ...form, destinatario: v })} options={destinatarios} />
        </div>
        <div className="mt-4 space-y-4">
          <Input label="Asunto" value={form.asunto} onChange={(v) => setForm({ ...form, asunto: v })} required />
          <Textarea label="Mensaje" value={form.mensaje} onChange={(v) => setForm({ ...form, mensaje: v })} />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={crear}>Crear</Button>
        </div>
      </Modal>

      <Modal open={!!respondiendo} onClose={() => setRespondiendo(null)} title={`Responder consulta #${respondiendo?.numero}`}>
        <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 mb-4">{respondiendo?.asunto}{respondiendo?.mensaje ? ` — ${respondiendo.mensaje}` : ''}</p>
        <Textarea label="Respuesta" value={respuesta} onChange={setRespuesta} rows={4} required />
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setRespondiendo(null)}>Cancelar</Button>
          <Button onClick={responder}>Enviar respuesta</Button>
        </div>
      </Modal>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Archive, Download, Trash2, Upload } from 'lucide-react';
import { supabase, type Archivo } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Spinner, Table, Td, Input } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate } from '@/lib/engine';

const categorias = ['reglamento', 'actas', 'planos', 'seguros', 'liquidaciones', 'legales', 'otros'];

export function Archivos() {
  const { consorcio, consorcios, usuario } = useApp();
  const [items, setItems] = useState<Archivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ consorcio_id: '', categoria: 'otros', nombre: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Archivo | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('archivos').select('*, consorcios(nombre)').order('created_at', { ascending: false });
    setItems((data as Archivo[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const visibles = items.filter((a) => !consorcio || !a.consorcio_id || a.consorcio_id === consorcio.id);

  const subir = async () => {
    if (!file) { setError('Elegí un archivo.'); return; }
    setBusy(true); setError('');
    const path = `docs/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
    const { error: upErr } = await supabase.storage.from('archivos').upload(path, file);
    if (upErr) { setError(`Error al subir: ${upErr.message}. ¿Corriste la parte de Storage de la migración?`); setBusy(false); return; }
    await supabase.from('archivos').insert({
      consorcio_id: form.consorcio_id || null, nombre: form.nombre.trim() || file.name,
      categoria: form.categoria, storage_path: path, subido_por: usuario,
    });
    setBusy(false); setModal(false); setFile(null);
    setForm({ consorcio_id: '', categoria: 'otros', nombre: '' });
    load();
  };

  const descargar = (a: Archivo) => {
    if (a.storage_path) {
      const { data } = supabase.storage.from('archivos').getPublicUrl(a.storage_path);
      window.open(data.publicUrl, '_blank');
    } else if (a.url_externa) window.open(a.url_externa, '_blank');
  };

  const borrar = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.storage_path) await supabase.storage.from('archivos').remove([deleteTarget.storage_path]);
    await supabase.from('archivos').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    load();
  };

  return (
    <div>
      <PageHeader title="Archivos" subtitle={consorcio ? `Documentación general y de ${consorcio.nombre}` : 'Documentación de la administración'}
        action={<Button onClick={() => { setForm((f) => ({ ...f, consorcio_id: consorcio?.id || '' })); setError(''); setModal(true); }}><Upload size={15} /> Subir archivo</Button>} />

      {loading ? <Spinner /> : visibles.length === 0 ? (
        <Card><EmptyState icon={<Archive size={28} />} title="Sin archivos" subtitle="Reglamentos, actas, planos, pólizas…" /></Card>
      ) : (
        <Card>
          <Table headers={['Nombre', 'Categoría', 'Consorcio', 'Subido por', 'Fecha', '']}>
            {visibles.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <Td className="font-medium">{a.nombre}</Td>
                <Td><Badge color="teal">{a.categoria}</Badge></Td>
                <Td className="text-slate-500">{(a.consorcios as { nombre?: string } | null | undefined)?.nombre || 'General'}</Td>
                <Td className="text-slate-500">{a.subido_por || '—'}</Td>
                <Td>{fmtDate(a.created_at.slice(0, 10))}</Td>
                <Td>
                  <div className="flex gap-1">
                    <button onClick={() => descargar(a)} className="p-1.5 rounded text-teal-600 hover:bg-teal-50" title="Descargar"><Download size={14} /></button>
                    <button onClick={() => setDeleteTarget(a)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Subir archivo">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Archivo</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-teal-50 file:text-teal-600 file:font-medium file:text-sm" />
          </div>
          <Input label="Nombre (opcional)" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} placeholder={file?.name || 'Igual al nombre del archivo'} />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Categoría" value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })} options={categorias.map((c) => ({ value: c, label: c }))} />
            <Select label="Consorcio" value={form.consorcio_id} onChange={(v) => setForm({ ...form, consorcio_id: v })} placeholder="— General —"
              options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} />
          </div>
        </div>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={subir} disabled={busy}>{busy ? 'Subiendo…' : 'Subir'}</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar archivo" message={`¿Eliminar "${deleteTarget?.nombre}"? También se borra del almacenamiento.`}
        onCancel={() => setDeleteTarget(null)} onConfirm={borrar} />
    </div>
  );
}

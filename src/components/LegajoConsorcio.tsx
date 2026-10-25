import { useEffect, useState } from 'react';
import { ExternalLink, Plus, Trash2, Upload } from 'lucide-react';
import { supabase, type Consorcio, type ConsorcioPoliza } from '@/lib/supabase';
import { Badge, Button, Input, Modal, Select, Spinner, Table, Td } from '@/components/ui';
import { fmtDate, fmtMoney, hoyISO } from '@/lib/engine';
import { Ayuda } from '@/components/Ayuda';

/*
  Legajo del consorcio: lo que piden el contador, el RPA y las aseguradoras.
  - Datos: CUIT, cuenta bancaria, última asamblea, vencimiento del mandato del administrador.
  - Pólizas y seguros obligatorios con vencimiento y archivo: incendio, ART, vida obligatorio, ascensores, RC.
  Los vencimientos aparecen en el Tablero y en el Calendario.
*/

export const TIPOS_POLIZA: Record<string, string> = { incendio: 'Seguro de incendio', art: 'ART', vida_obligatorio: 'Seguro de vida obligatorio', ascensores: 'Seguro de ascensores', responsabilidad_civil: 'Responsabilidad civil', otro: 'Otro' };
export const diasHasta = (fecha: string) => Math.round((new Date(fecha).getTime() - new Date(hoyISO()).getTime()) / 86400000);
export const colorVenc = (fecha: string): 'red' | 'amber' | 'green' => { const d = diasHasta(fecha); return d < 0 ? 'red' : d <= 30 ? 'amber' : 'green'; };

export function LegajoConsorcio({ consorcio, open, onClose, onGuardado }: { consorcio: Consorcio | null; open: boolean; onClose: () => void; onGuardado: () => void }) {
  const [loading, setLoading] = useState(false);
  const [polizas, setPolizas] = useState<ConsorcioPoliza[]>([]);
  const [datos, setDatos] = useState({ cuit: '', banco: '', cbu: '', fecha_asamblea: '', fecha_mandato_hasta: '' });
  const [form, setForm] = useState({ tipo: 'incendio', compania: '', numero: '', vencimiento: '', monto: '', notas: '' });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const { data } = await supabase.from('consorcio_polizas').select('*').eq('consorcio_id', consorcio.id).order('vencimiento');
    setPolizas((data as ConsorcioPoliza[]) || []);
    setDatos({ cuit: consorcio.cuit || '', banco: consorcio.banco || '', cbu: consorcio.cbu || '', fecha_asamblea: consorcio.fecha_asamblea || '', fecha_mandato_hasta: consorcio.fecha_mandato_hasta || '' });
    setLoading(false);
  };
  useEffect(() => { if (open) { setMsg(''); load(); } }, [open, consorcio?.id]);

  const guardarDatos = async () => {
    if (!consorcio) return;
    setBusy(true);
    const { error } = await supabase.from('consorcios').update({ cuit: datos.cuit || null, banco: datos.banco || null, cbu: datos.cbu || null, fecha_asamblea: datos.fecha_asamblea || null, fecha_mandato_hasta: datos.fecha_mandato_hasta || null }).eq('id', consorcio.id);
    setMsg(error ? `Error: ${error.message}` : 'Datos guardados.');
    setBusy(false); onGuardado();
  };

  const agregarPoliza = async () => {
    if (!consorcio) return;
    if (!form.vencimiento) { setMsg('Error: la póliza necesita fecha de vencimiento.'); return; }
    setBusy(true); setMsg('');
    let archivo_path: string | null = null;
    if (archivo) {
      archivo_path = `polizas/${consorcio.id}/${Date.now()}_${archivo.name.replace(/[^\w.\-]/g, '_')}`;
      const { error } = await supabase.storage.from('archivos').upload(archivo_path, archivo);
      if (error) { setMsg(`Error al subir el archivo: ${error.message}`); setBusy(false); return; }
    }
    const { error } = await supabase.from('consorcio_polizas').insert({ consorcio_id: consorcio.id, tipo: form.tipo, compania: form.compania || null, numero: form.numero || null, vencimiento: form.vencimiento, monto: parseFloat(form.monto) || null, notas: form.notas || null, archivo_path });
    if (error) setMsg(`Error: ${error.message}`); else { setForm({ tipo: 'incendio', compania: '', numero: '', vencimiento: '', monto: '', notas: '' }); setArchivo(null); }
    setBusy(false); load();
  };

  const verArchivo = (path: string) => window.open(supabase.storage.from('archivos').getPublicUrl(path).data.publicUrl, '_blank');

  return (
    <Modal open={open} onClose={onClose} title={`Legajo · ${consorcio?.nombre || ''}`} size="lg">
      {loading ? <Spinner /> : <>
        <Ayuda id="legajo" titulo="Qué va en el legajo y para qué">
          <ul>
            <li><b>Seguros obligatorios</b>: incendio del edificio (lo exige la Ley 13.512 / CCyC), ART y vida obligatorio del encargado (si hay empleados), ascensores (si tiene). Cargá cada póliza con su vencimiento: el Tablero avisa 45 días antes.</li>
            <li><b>Mandato</b>: el administrador se designa en asamblea por un plazo (en CABA, 1 año renovable). Cargá hasta cuándo rige para que te avise antes de que venza.</li>
            <li><b>CUIT y banco</b>: los pide el RPA en la DDJJ anual y el contador para las presentaciones.</li>
          </ul>
        </Ayuda>
        <p className="text-sm font-semibold text-slate-700 mb-2">Datos del consorcio</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Input label="CUIT" value={datos.cuit} onChange={(v) => setDatos({ ...datos, cuit: v })} />
          <Input label="Banco" value={datos.banco} onChange={(v) => setDatos({ ...datos, banco: v })} />
          <Input label="CBU / N° de cuenta" value={datos.cbu} onChange={(v) => setDatos({ ...datos, cbu: v })} />
          <Input label="Última asamblea ordinaria" type="date" value={datos.fecha_asamblea} onChange={(v) => setDatos({ ...datos, fecha_asamblea: v })} />
          <Input label="Mandato del administrador hasta" type="date" value={datos.fecha_mandato_hasta} onChange={(v) => setDatos({ ...datos, fecha_mandato_hasta: v })} />
          <div className="flex items-end"><Button variant="secondary" onClick={guardarDatos} disabled={busy}>Guardar datos</Button></div>
        </div>
        {datos.fecha_mandato_hasta && diasHasta(datos.fecha_mandato_hasta) <= 60 && <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-1.5 mt-2">El mandato {diasHasta(datos.fecha_mandato_hasta) < 0 ? 'venció' : 'vence'} el {fmtDate(datos.fecha_mandato_hasta)}: hay que renovarlo en asamblea (en CABA, el RPA pide la designación vigente para la DDJJ anual).</p>}

        <p className="text-sm font-semibold text-slate-700 mt-5 mb-2">Pólizas y seguros obligatorios</p>
        <Table headers={['Tipo', 'Compañía', 'N° póliza', 'Vencimiento', 'Prima', 'Archivo', '']}>
          {polizas.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <Td className="font-medium">{TIPOS_POLIZA[p.tipo] || p.tipo}{p.notas && <div className="text-xs text-slate-400">{p.notas}</div>}</Td>
              <Td>{p.compania || '—'}</Td>
              <Td className="font-mono text-xs">{p.numero || '—'}</Td>
              <Td><Badge color={colorVenc(p.vencimiento)}>{fmtDate(p.vencimiento)}{diasHasta(p.vencimiento) < 0 ? ' · vencida' : diasHasta(p.vencimiento) <= 30 ? ` · ${diasHasta(p.vencimiento)} días` : ''}</Badge></Td>
              <Td>{p.monto ? fmtMoney(Number(p.monto)) : '—'}</Td>
              <Td>{p.archivo_path ? <button onClick={() => verArchivo(p.archivo_path!)} className="text-teal-600 text-xs font-medium inline-flex items-center gap-1"><ExternalLink size={12} /> ver</button> : '—'}</Td>
              <Td><button onClick={async () => { await supabase.from('consorcio_polizas').delete().eq('id', p.id); load(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td>
            </tr>
          ))}
          {polizas.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-400 py-6">Sin pólizas cargadas. Obligatorias: incendio del edificio, ART y vida del encargado, y ascensores si tiene.</Td></tr>}
        </Table>
        <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Select label="Tipo" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })} options={Object.entries(TIPOS_POLIZA).map(([value, label]) => ({ value, label }))} />
            <Input label="Compañía" value={form.compania} onChange={(v) => setForm({ ...form, compania: v })} />
            <Input label="N° póliza" value={form.numero} onChange={(v) => setForm({ ...form, numero: v })} />
            <Input label="Vencimiento" type="date" value={form.vencimiento} onChange={(v) => setForm({ ...form, vencimiento: v })} required />
            <Input label="Prima ($)" type="number" step="0.01" value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} />
            <Input label="Notas" value={form.notas} onChange={(v) => setForm({ ...form, notas: v })} />
            <label className="text-sm text-slate-600 flex flex-col justify-end"><span className="text-xs font-medium text-slate-500 mb-1">Póliza (PDF)</span><span className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50 text-xs"><Upload size={13} /> {archivo ? archivo.name.slice(0, 18) : 'Elegir archivo'}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] || null)} /></span></label>
            <div className="flex items-end"><Button onClick={agregarPoliza} disabled={busy}><Plus size={15} /> Agregar</Button></div>
          </div>
        </div>
        {msg && <p className={`text-sm mt-3 ${msg.startsWith('Error') ? 'text-red-500' : 'text-emerald-600'}`}>{msg}</p>}
      </>}
    </Modal>
  );
}

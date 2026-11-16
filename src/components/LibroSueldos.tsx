import { useState } from 'react';
import { Download } from 'lucide-react';
import { supabase, type Consorcio, type SueldoLiquidacion } from '@/lib/supabase';
import { Button, Modal } from '@/components/ui';
import { exportCSV, periodoLabel } from '@/lib/engine';
import { codigoConcepto, F931_DEFECTO, generarLsd, validarLsd, type DatosF931, type EmpleadoLsd } from '@/lib/lsd';

const CAMPOS: { k: keyof DatosF931; label: string; largo: number; ancho: string }[] = [
  { k: 'legajo', label: 'Legajo', largo: 10, ancho: 'w-20' }, { k: 'actividad', label: 'Actividad', largo: 3, ancho: 'w-16' }, { k: 'modalidad', label: 'Modalidad', largo: 3, ancho: 'w-16' },
  { k: 'localidad', label: 'Zona', largo: 2, ancho: 'w-14' }, { k: 'obra_social', label: 'Obra social', largo: 6, ancho: 'w-20' }, { k: 'situacion', label: 'Situación', largo: 2, ancho: 'w-14' },
  { k: 'condicion', label: 'Condición', largo: 2, ancho: 'w-14' }, { k: 'hijos', label: 'Hijos', largo: 2, ancho: 'w-12' },
];

/**
 * Libro de Sueldos Digital: arma el TXT de "Liquidación de SyJ / DJ F931" para subir a ARCA.
 * Los códigos de cada empleado se cargan una sola vez (los da el contador, salen de las tablas de Declaración en Línea).
 */
export function LibroSueldos({ consorcio, periodo, liqs, onClose, onSaved }: { consorcio: Consorcio; periodo: string; liqs: SueldoLiquidacion[]; onClose: () => void; onSaved: () => void }) {
  const listas = liqs.filter((l) => l.estado !== 'preliquidada' && l.empleados);
  const [datos, setDatos] = useState<Record<string, DatosF931>>(() => Object.fromEntries(listas.map((l) => [l.empleado_id, { ...F931_DEFECTO, ...((l.empleados as unknown as { datos_f931?: DatosF931 }).datos_f931 || {}) }])));
  const [nro, setNro] = useState('1');
  const [errores, setErrores] = useState<string[]>([]);
  const [msg, setMsg] = useState('');

  const emps: EmpleadoLsd[] = listas.map((l, i) => ({
    nombre: l.empleados!.nombre, cuil: l.empleados!.cuil, cbu: l.empleados!.cbu, datos: datos[l.empleado_id] || {}, orden: i + 1,
    lineas: (l.detalle || []).map((d) => ({ concepto: d.concepto, tipo: d.tipo, monto: Number(d.monto) })), bruto: Number(l.bruto), noRemunerativo: Number(l.no_remunerativo), fechaPago: l.fecha_pago,
  }));
  const set = (id: string, k: keyof DatosF931, v: string | boolean) => setDatos({ ...datos, [id]: { ...datos[id], [k]: k === 'hijos' ? parseInt(String(v)) || 0 : v } });
  const guardar = async () => { for (const l of listas) await supabase.from('empleados').update({ datos_f931: datos[l.empleado_id] }).eq('id', l.empleado_id); onSaved(); };
  const descargar = async () => {
    const e = validarLsd(consorcio.cuit, emps); setErrores(e); setMsg('');
    if (e.length) return;
    await guardar();
    const txt = generarLsd(consorcio.cuit!, periodo, parseInt(nro) || 1, emps);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=us-ascii' }));
    a.download = `LSD_${(consorcio.cuit || '').replace(/\D/g, '')}_${periodo.replace('-', '')}.txt`; a.click(); URL.revokeObjectURL(a.href);
    setMsg('Archivo generado. Subilo en ARCA → Libro de Sueldos Digital → Liquidaciones → Carga por archivo. Si ARCA marca algún error, pasámelo tal cual.');
  };
  const conceptos = () => {
    const vistos = new Map<string, [string, string]>();
    for (const x of emps) for (const l of x.lineas) vistos.set(codigoConcepto(l.concepto), [l.concepto, l.tipo === 'rem' ? 'Remunerativo' : l.tipo === 'norem' ? 'No remunerativo' : 'Descuento']);
    exportCSV(`LSD_conceptos_${consorcio.nombre}.csv`, ['Código', 'Descripción', 'Tipo'], [...vistos.entries()].map(([c, [d, t]]) => [c, d, t]));
  };

  return (
    <Modal open onClose={onClose} title={`Libro de Sueldos Digital · ${periodoLabel(periodo)}`} size="lg">
      <p className="text-sm text-slate-500 mb-3">Genera el archivo que se sube a ARCA; con él ARCA arma el libro y la declaración jurada F931. Los códigos los da el contador (tablas de Declaración en Línea) y se cargan una sola vez por empleado.</p>
      {listas.length === 0 ? <p className="text-sm text-amber-700">No hay liquidaciones confirmadas en este período.</p> : (
        <div className="overflow-x-auto"><table className="text-sm w-full"><thead><tr className="text-xs text-slate-500 text-left">
          <th className="py-1 pr-2">Empleado</th>{CAMPOS.map((c) => <th key={c.k} className="py-1 pr-2">{c.label}</th>)}<th className="py-1">Cónyuge</th></tr></thead>
          <tbody>{listas.map((l) => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{l.empleados!.nombre}<span className="block text-xs font-normal text-slate-400">{l.empleados!.cuil || 'sin CUIL'}</span></td>
              {CAMPOS.map((c) => <td key={c.k} className="py-1.5 pr-2"><input aria-label={`${c.label} de ${l.empleados!.nombre}`} maxLength={c.largo} value={String(datos[l.empleado_id]?.[c.k] ?? '')} onChange={(e) => set(l.empleado_id, c.k, e.target.value)} className={`${c.ancho} px-2 py-1 rounded border border-slate-200 text-sm`} /></td>)}
              <td className="py-1.5"><input type="checkbox" checked={!!datos[l.empleado_id]?.conyuge} onChange={(e) => set(l.empleado_id, 'conyuge', e.target.checked)} /></td>
            </tr>))}</tbody></table></div>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-600 mt-4">N° de liquidación en ARCA para este período <input value={nro} onChange={(e) => setNro(e.target.value)} className="w-16 px-2 py-1 rounded border border-slate-200 text-sm" /></label>
      {errores.length > 0 && <ul className="text-sm text-red-600 mt-3 list-disc pl-5">{errores.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {msg && <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 mt-3">{msg}</p>}
      <p className="text-xs text-slate-400 mt-3">Antes de la primera presentación, el contador tiene que dar de alta en ARCA los conceptos con los mismos códigos (botón "Conceptos") y asociarlos a los conceptos de ARCA. Bases imponibles: se informa el remunerativo sin topes ni detracciones.</p>
      <div className="flex justify-end gap-2 mt-5 flex-wrap">
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        <Button variant="secondary" onClick={conceptos} disabled={!listas.length}><Download size={15} /> Conceptos</Button>
        <Button onClick={descargar} disabled={!listas.length}><Download size={15} /> Descargar TXT</Button>
      </div>
    </Modal>
  );
}

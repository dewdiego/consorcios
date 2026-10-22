import { useEffect, useState, type ReactNode } from 'react';
import { Calendar, Clock, HelpCircle, Plus, ShoppingCart, StickyNote, Truck, X } from 'lucide-react';
import { supabase, type Proveedor, type Rubro } from '@/lib/supabase';
import { Button } from '@/components/ui';
import { fmtMoney, hoyISO, periodoActual, round2 } from '@/lib/engine';

/*
  Alta de gasto con formato Octavo:
  un mismo comprobante puede repartirse entre las categorías A / B / C / D.
*/

const TIPOS_COMPROBANTE = ['Factura A', 'Factura B', 'Factura C', 'Factura M', 'Ticket', 'Recibo', 'Nota de crédito', 'Nota de débito', 'Otro'];

type Props = {
  open: boolean;
  onClose: () => void;
  consorcioId: string;
  liquidacionId: string | null; // null = queda en Gastos pendientes
  onSaved: () => void;
};

const vacio = () => ({
  proveedor_id: '', rubro_id: '', descripcion: '', periodo_facturado: periodoActual(), fecha: hoyISO(),
  tipo_comprobante: 'Factura A', comprobante: '', recurrente: false, extraordinario: false,
  monto_a: '', monto_b: '', monto_c: '', monto_d: '', notas: '',
});

const inputCls = 'w-full px-3 py-2 text-sm text-slate-700 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500';

function Campo({ label, ayuda, children }: { label: ReactNode; ayuda?: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-slate-600">{label}</label>
        {ayuda && <span title={ayuda}><HelpCircle size={13} className="text-slate-400" /></span>}
      </div>
      {children}
    </div>
  );
}

function ConPrefijo({ prefijo, children }: { prefijo: ReactNode; children: ReactNode }) {
  return (
    <div className="flex">
      <span className="flex items-center px-2.5 border border-r-0 border-slate-200 rounded-l-md bg-slate-50 text-slate-500 text-sm">{prefijo}</span>
      <div className="flex-1 [&>input]:rounded-l-none [&>select]:rounded-l-none">{children}</div>
    </div>
  );
}

export function GastoModal({ open, onClose, consorcioId, liquidacionId, onSaved }: Props) {
  const [tab, setTab] = useState<'gasto' | 'notas'>('gasto');
  const [form, setForm] = useState(vacio());
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [nuevoProv, setNuevoProv] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cargarListas = async () => {
    const [p, r] = await Promise.all([
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('rubros').select('*').order('orden'),
    ]);
    setProveedores((p.data as Proveedor[]) || []);
    setRubros((r.data as Rubro[]) || []);
  };

  useEffect(() => {
    if (!open) return;
    setForm(vacio()); setTab('gasto'); setError(''); setNuevoProv(null);
    cargarListas();
  }, [open]);

  if (!open) return null;

  const set = (k: keyof ReturnType<typeof vacio>, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => parseFloat(v.replace(',', '.')) || 0;
  const total = round2(num(form.monto_a) + num(form.monto_b) + num(form.monto_c) + num(form.monto_d));

  const agregarProveedor = async () => {
    if (!nuevoProv?.trim()) return;
    const { data, error: err } = await supabase.from('proveedores').insert({ nombre: nuevoProv.trim() }).select().single();
    if (err) { setError(err.message); return; }
    await cargarListas();
    set('proveedor_id', data.id);
    setNuevoProv(null);
  };

  const guardar = async () => {
    if (total <= 0) { setError('Cargá el importe en al menos una categoría (A, B, C o D).'); return; }
    const prov = proveedores.find((p) => p.id === form.proveedor_id);
    const rubro = rubros.find((r) => r.id === form.rubro_id);
    const descripcion = form.descripcion.trim() || prov?.nombre || rubro?.nombre || '';
    if (!descripcion) { setError('Completá proveedor, categoría o descripción.'); return; }
    const a = num(form.monto_a), b = num(form.monto_b), c = num(form.monto_c), d = num(form.monto_d);
    setSaving(true); setError('');
    const { error: err } = await supabase.from('gastos').insert({
      consorcio_id: consorcioId, liquidacion_id: liquidacionId,
      proveedor_id: form.proveedor_id || null, rubro_id: form.rubro_id || null,
      descripcion, monto: total, monto_a: a, monto_b: b, monto_c: c, monto_d: d,
      categoria: a > 0 ? 'A' : b > 0 ? 'B' : c > 0 ? 'C' : 'D',
      fecha: form.fecha, periodo_facturado: form.periodo_facturado || null,
      tipo_comprobante: form.tipo_comprobante, comprobante: form.comprobante || null,
      recurrente: form.recurrente, extraordinario: form.extraordinario, notas: form.notas || null,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
    onClose();
  };

  const navItem = (key: 'gasto' | 'notas', icon: ReactNode, label: string) => (
    <button onClick={() => setTab(key)}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${tab === key ? 'bg-teal-50 text-[#1e2a4a] font-semibold' : 'text-[#1e2a4a] hover:bg-slate-50'}`}>
      <span className="text-teal-500">{icon}</span>{label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4">
          <h3 className="text-lg font-semibold text-[#1e2a4a]">Datos del gasto</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-44 shrink-0 px-3 space-y-1 hidden sm:block">
            {navItem('gasto', <ShoppingCart size={15} />, 'Gasto')}
            {navItem('notas', <StickyNote size={15} />, 'Notas')}
          </aside>

          <div className="flex-1 overflow-y-auto px-6 pb-4">
            {tab === 'gasto' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4">
                {/* Proveedor */}
                <div className="col-span-2 sm:col-span-3">
                  <Campo label={<span className="flex items-center gap-1">Proveedor
                    <button type="button" onClick={() => setNuevoProv(nuevoProv === null ? '' : null)} className="text-teal-500 hover:text-teal-600" title="Nuevo proveedor"><Plus size={15} /></button></span>}>
                    {nuevoProv !== null ? (
                      <div className="flex gap-2">
                        <input autoFocus className={inputCls} placeholder="Nombre del nuevo proveedor" value={nuevoProv}
                          onChange={(e) => setNuevoProv(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregarProveedor()} />
                        <Button size="sm" onClick={agregarProveedor}>Agregar</Button>
                      </div>
                    ) : (
                      <ConPrefijo prefijo={<Truck size={14} />}>
                        <select className={inputCls} value={form.proveedor_id} onChange={(e) => set('proveedor_id', e.target.value)}>
                          <option value="">—</option>
                          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </ConPrefijo>
                    )}
                  </Campo>
                </div>
                <Campo label="Recurrente?" ayuda="Gasto que se repite todos los meses">
                  <select className={inputCls} value={form.recurrente ? 'SI' : 'NO'} onChange={(e) => set('recurrente', e.target.value === 'SI')}>
                    <option value="NO">NO</option><option value="SI">SI</option>
                  </select>
                </Campo>

                {/* Categoría (rubro) */}
                <div className="col-span-2 sm:col-span-3">
                  <Campo label="Categoria">
                    <select className={inputCls} value={form.rubro_id} onChange={(e) => set('rubro_id', e.target.value)}>
                      <option value="">Seleccione una opción</option>
                      {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </Campo>
                </div>
                <Campo label="Extraordinario?" ayuda="Se informa separado de los gastos ordinarios">
                  <select className={inputCls} value={form.extraordinario ? 'SI' : 'NO'} onChange={(e) => set('extraordinario', e.target.value === 'SI')}>
                    <option value="NO">NO</option><option value="SI">SI</option>
                  </select>
                </Campo>

                {/* Descripción */}
                <div className="col-span-2 sm:col-span-4">
                  <Campo label="Descripción">
                    <textarea rows={1} className={`${inputCls} resize-y`} value={form.descripcion} onChange={(e) => set('descripcion', e.target.value)} />
                  </Campo>
                </div>

                {/* Comprobante */}
                <Campo label="Periodo facturado" ayuda="Mes al que corresponde el servicio facturado">
                  <ConPrefijo prefijo={<Clock size={14} />}>
                    <input type="month" className={inputCls} value={form.periodo_facturado} onChange={(e) => set('periodo_facturado', e.target.value)} />
                  </ConPrefijo>
                </Campo>
                <Campo label="Fecha comprobante" ayuda="Fecha de emisión de la factura">
                  <ConPrefijo prefijo={<Calendar size={14} />}>
                    <input type="date" className={inputCls} value={form.fecha} onChange={(e) => set('fecha', e.target.value)} />
                  </ConPrefijo>
                </Campo>
                <Campo label="Tipo comprobante" ayuda="Tipo de comprobante recibido">
                  <select className={inputCls} value={form.tipo_comprobante} onChange={(e) => set('tipo_comprobante', e.target.value)}>
                    {TIPOS_COMPROBANTE.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Campo>
                <Campo label="Número comprobante" ayuda="Ej: 0001-00012345">
                  <input className={inputCls} value={form.comprobante} onChange={(e) => set('comprobante', e.target.value)} />
                </Campo>

                {/* Importes por categoría de prorrateo */}
                <Campo label="A expensas ordinarias">
                  <ConPrefijo prefijo="$"><input type="number" step="0.01" placeholder="0.00" className={`${inputCls} text-right`} value={form.monto_a} onChange={(e) => set('monto_a', e.target.value)} /></ConPrefijo>
                </Campo>
                <Campo label="B cocheras">
                  <ConPrefijo prefijo="$"><input type="number" step="0.01" placeholder="0.00" className={`${inputCls} text-right`} value={form.monto_b} onChange={(e) => set('monto_b', e.target.value)} /></ConPrefijo>
                </Campo>
                <Campo label="C cuota extr.">
                  <ConPrefijo prefijo="$"><input type="number" step="0.01" placeholder="0.00" className={`${inputCls} text-right`} value={form.monto_c} onChange={(e) => set('monto_c', e.target.value)} /></ConPrefijo>
                </Campo>
                <Campo label="Total D">
                  <ConPrefijo prefijo="$"><input type="number" step="0.01" placeholder="0.00" className={`${inputCls} text-right`} value={form.monto_d} onChange={(e) => set('monto_d', e.target.value)} /></ConPrefijo>
                </Campo>

                <p className="col-span-2 sm:col-span-4 text-right text-sm text-slate-500">Total del comprobante: <b className="text-slate-800">{fmtMoney(total)}</b></p>
              </div>
            ) : (
              <Campo label="Notas internas">
                <textarea rows={8} className={`${inputCls} resize-y`} value={form.notas} onChange={(e) => set('notas', e.target.value)} placeholder="Observaciones del gasto (no se muestran en la expensa)" />
              </Campo>
            )}
            {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4">
          <button onClick={onClose} className="px-10 py-2 rounded-full bg-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-300">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="px-10 py-2 rounded-full bg-teal-400 text-white text-sm font-semibold hover:bg-teal-500 disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

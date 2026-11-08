import { useEffect, useState } from 'react';
import { supabase, type Consorcio } from '@/lib/supabase';
import { Button, Input, Modal, Select } from '@/components/ui';

/*
  Configuración del módulo de expensas (por consorcio), como la de Octavo:
  intereses, monto fijo a deudores, redondeo, vencimientos en días no hábiles,
  días de vencimiento, honorarios, y la carpeta externa de comprobantes (Drive) que ve el vecino.
*/
export function ConfigExpensas({ open, onClose, consorcio, onGuardado }: { open: boolean; onClose: () => void; consorcio: Consorcio; onGuardado: () => void }) {
  const [f, setF] = useState({
    interes_mora_mensual_pct: '', recargo_2do_venc_pct: '', monto_fijo_deudores: '', redondeo: 'ninguno', venc_no_habil: 'no_modificar',
    dia_vencimiento_1: '', dia_vencimiento_2: '', honorarios_mensuales: '', url_comprobantes: '', mostrar_facturas_portal: true,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!open) return;
    setMsg('');
    setF({
      interes_mora_mensual_pct: String(consorcio.interes_mora_mensual_pct ?? 0), recargo_2do_venc_pct: String(consorcio.recargo_2do_venc_pct ?? 0),
      monto_fijo_deudores: String(consorcio.monto_fijo_deudores ?? 0), redondeo: consorcio.redondeo || 'ninguno', venc_no_habil: consorcio.venc_no_habil || 'no_modificar',
      dia_vencimiento_1: String(consorcio.dia_vencimiento_1 ?? 10), dia_vencimiento_2: String(consorcio.dia_vencimiento_2 ?? 20),
      honorarios_mensuales: String(consorcio.honorarios_mensuales ?? 0), url_comprobantes: consorcio.url_comprobantes || '', mostrar_facturas_portal: consorcio.mostrar_facturas_portal !== false,
    });
  }, [open, consorcio.id]);

  const guardar = async () => {
    setBusy(true);
    const { error } = await supabase.from('consorcios').update({
      interes_mora_mensual_pct: parseFloat(f.interes_mora_mensual_pct) || 0, recargo_2do_venc_pct: parseFloat(f.recargo_2do_venc_pct) || 0,
      monto_fijo_deudores: parseFloat(f.monto_fijo_deudores) || 0, redondeo: f.redondeo, venc_no_habil: f.venc_no_habil,
      dia_vencimiento_1: Math.min(28, parseInt(f.dia_vencimiento_1) || 10), dia_vencimiento_2: Math.min(28, parseInt(f.dia_vencimiento_2) || 20),
      honorarios_mensuales: parseFloat(f.honorarios_mensuales) || 0, url_comprobantes: f.url_comprobantes.trim() || null, mostrar_facturas_portal: f.mostrar_facturas_portal,
    }).eq('id', consorcio.id);
    setBusy(false);
    if (error) { setMsg(`Error: ${error.message}`); return; }
    onGuardado(); onClose();
  };
  const s = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });

  return (
    <Modal open={open} onClose={onClose} title={`Configuración de expensas · ${consorcio.nombre}`} size="lg">
      <p className="text-sm font-semibold text-slate-700 mb-2">Datos básicos</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Input label="Interés por pago después del 1er vto (% mensual)" type="number" step="0.01" value={f.interes_mora_mensual_pct} onChange={(v) => s('interes_mora_mensual_pct', v)} />
        <Input label="Recargo por pago después del 2do vto (%)" type="number" step="0.01" value={f.recargo_2do_venc_pct} onChange={(v) => s('recargo_2do_venc_pct', v)} />
        <Input label="Monto fijo aplicable a deudores ($)" type="number" step="0.01" value={f.monto_fijo_deudores} onChange={(v) => s('monto_fijo_deudores', v)} />
        <Select label="Manejo de redondeos" value={f.redondeo} onChange={(v) => s('redondeo', v)} options={[{ value: 'ninguno', label: 'Sin redondeo (centavos)' }, { value: 'unidad', label: 'A la unidad ($1)' }, { value: 'decena', label: 'A la decena ($10)' }, { value: 'centena', label: 'A la centena ($100)' }]} />
        <Select label="Vencimientos en días no hábiles" value={f.venc_no_habil} onChange={(v) => s('venc_no_habil', v)} options={[{ value: 'no_modificar', label: 'No modificar' }, { value: 'siguiente_habil', label: 'Pasar al siguiente día hábil' }, { value: 'anterior_habil', label: 'Pasar al día hábil anterior' }]} />
        <Input label="Honorarios de administración ($/mes)" type="number" step="0.01" value={f.honorarios_mensuales} onChange={(v) => s('honorarios_mensuales', v)} />
        <Input label="Día del 1er vencimiento" type="number" value={f.dia_vencimiento_1} onChange={(v) => s('dia_vencimiento_1', v)} />
        <Input label="Día del 2do vencimiento" type="number" value={f.dia_vencimiento_2} onChange={(v) => s('dia_vencimiento_2', v)} />
      </div>
      <p className="text-xs text-slate-400 mt-2">El interés y el monto fijo se aplican sobre el saldo anterior sólo a las unidades que deben. El redondeo es hacia arriba sobre el total del cupón. Rige para las liquidaciones que se generen de ahora en más.</p>

      <p className="text-sm font-semibold text-slate-700 mt-5 mb-2">Comprobantes de gastos (lo que ve el vecino)</p>
      <div className="grid grid-cols-1 gap-3">
        <Input label="Carpeta externa de comprobantes (link de Drive, opcional)" value={f.url_comprobantes} onChange={(v) => s('url_comprobantes', v)} placeholder="https://drive.google.com/drive/folders/…" />
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="rounded" checked={f.mostrar_facturas_portal} onChange={(e) => s('mostrar_facturas_portal', e.target.checked)} /> Mostrar en el portal el detalle de gastos de cada expensa con las facturas adjuntas</label>
      </div>
      <p className="text-xs text-slate-400 mt-2">Las facturas se adjuntan en cada gasto (botón "Factura" al cargarlo). Si además usás una carpeta de Drive, el portal muestra el link a la carpeta.</p>
      {msg && <p className="text-sm text-red-500 mt-3">{msg}</p>}
      <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={guardar} disabled={busy}>Guardar</Button></div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase, type Cuenta, type Gasto } from '@/lib/supabase';
import { Button, Input, Modal, Select } from '@/components/ui';
import { fmtMoney, hoyISO, round2 } from '@/lib/engine';

type Linea = { cuenta_id: string; monto: string };
const num = (s: string) => parseFloat(String(s).replace(',', '.')) || 0;

/**
 * Pago directo de un gasto, sin orden de pago. Se puede partir entre dos o más cuentas (por ejemplo, parte en efectivo
 * y parte por banco): cada parte genera su egreso en la cuenta elegida. Si el gasto ya fue pagado así, permite anularlo.
 */
export function PagarGasto({ gasto, onClose, onDone }: { gasto: Gasto | null; onClose: () => void; onDone: () => void }) {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [fecha, setFecha] = useState(hoyISO());
  const [pagosPrevios, setPagosPrevios] = useState(0);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!gasto) return;
    setErr(''); setFecha(hoyISO());
    (async () => {
      const [{ data: cs }, { count }] = await Promise.all([
        supabase.from('cuentas').select('*').eq('consorcio_id', gasto.consorcio_id).eq('activa', true).order('nombre'),
        supabase.from('movimientos').select('id', { count: 'exact', head: true }).eq('origen', 'gasto').eq('origen_id', gasto.id),
      ]);
      const lista = (cs as Cuenta[]) || []; setCuentas(lista); setPagosPrevios(count || 0);
      setLineas([{ cuenta_id: lista.find((c) => c.predeterminada)?.id || lista[0]?.id || '', monto: String(gasto.monto) }]);
    })();
  }, [gasto?.id]);
  if (!gasto) return null;

  const total = round2(lineas.reduce((a, l) => a + num(l.monto), 0));
  const falta = round2(Number(gasto.monto) - total);
  const cambiar = (i: number, k: keyof Linea, v: string) => setLineas(lineas.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const partir = () => {
    const otra = cuentas.find((c) => !lineas.some((l) => l.cuenta_id === c.id))?.id || cuentas[0]?.id || '';
    setLineas([...lineas, { cuenta_id: otra, monto: falta > 0 ? String(falta) : '' }]);
  };
  const pagar = async () => {
    if (!cuentas.length) return setErr('Primero creá una caja o cuenta en Contabilidad.');
    if (lineas.some((l) => !l.cuenta_id || num(l.monto) <= 0)) return setErr('Cada parte necesita cuenta y monto.');
    if (Math.abs(falta) > 0.01) return setErr(falta > 0 ? `Faltan ${fmtMoney(falta)} para cubrir el gasto.` : `Sobran ${fmtMoney(-falta)}: el total tiene que ser ${fmtMoney(gasto.monto)}.`);
    setBusy(true);
    const { error } = await supabase.from('movimientos').insert(lineas.map((l) => ({
      consorcio_id: gasto.consorcio_id, cuenta_id: l.cuenta_id, fecha, tipo: 'egreso', monto: num(l.monto), origen: 'gasto', origen_id: gasto.id,
      concepto: `Pago ${gasto.descripcion}${lineas.length > 1 ? ' (parcial)' : ''}`.slice(0, 200), comprobante: gasto.comprobante || null,
    })));
    if (!error) await supabase.from('gastos').update({ pagado: true, fecha_pago: fecha }).eq('id', gasto.id);
    setBusy(false);
    if (error) return setErr(error.message);
    onDone(); onClose();
  };
  const anular = async () => {
    setBusy(true);
    await supabase.from('movimientos').delete().eq('origen', 'gasto').eq('origen_id', gasto.id);
    await supabase.from('gastos').update({ pagado: false, fecha_pago: null }).eq('id', gasto.id);
    setBusy(false); onDone(); onClose();
  };

  return (
    <Modal open onClose={onClose} title={gasto.pagado ? 'Pago del gasto' : 'Pagar gasto'}>
      <p className="text-sm text-slate-600 mb-3"><b>{gasto.descripcion}</b> · {fmtMoney(gasto.monto)}</p>
      {gasto.pagado ? (
        pagosPrevios > 0 ? <>
          <p className="text-sm text-slate-500">Este gasto se pagó en {pagosPrevios} parte(s). Si lo anulás, se borran esos egresos de las cuentas y vuelve a quedar pendiente.</p>
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button variant="danger" onClick={anular} disabled={busy}>Anular pago</Button></div>
        </> : <p className="text-sm text-slate-500">Este gasto figura pagado por otra vía (orden de pago, sueldos o importación).</p>
      ) : <>
        <div className="max-w-[200px] mb-3"><Input label="Fecha de pago" type="date" value={fecha} onChange={setFecha} /></div>
        {lineas.map((l, i) => (
          <div key={i} className="flex gap-2 items-end mb-2">
            <div className="flex-1"><Select label={i === 0 ? 'Sale de' : undefined} value={l.cuenta_id} onChange={(v) => cambiar(i, 'cuenta_id', v)} options={cuentas.map((c) => ({ value: c.id, label: c.nombre }))} /></div>
            <div className="w-36"><Input label={i === 0 ? 'Monto' : undefined} type="number" step="0.01" value={l.monto} onChange={(v) => cambiar(i, 'monto', v)} /></div>
            {lineas.length > 1 && <button title="Quitar" onClick={() => setLineas(lineas.filter((_, j) => j !== i))} className="p-2 mb-1 rounded text-red-400 hover:bg-red-50"><X size={15} /></button>}
          </div>
        ))}
        <div className="flex items-center justify-between mt-1">
          <button onClick={partir} className="text-sm text-teal-600 font-medium inline-flex items-center gap-1"><Plus size={14} /> Partir el pago con otra cuenta</button>
          {Math.abs(falta) > 0.01 && <span className="text-xs text-amber-700">{falta > 0 ? `Faltan ${fmtMoney(falta)}` : `Sobran ${fmtMoney(-falta)}`}</span>}
        </div>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={pagar} disabled={busy}>Confirmar pago</Button></div>
      </>}
    </Modal>
  );
}

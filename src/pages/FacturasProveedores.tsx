import { useEffect, useState } from 'react';
import { Check, FileText, Inbox, X } from 'lucide-react';
import { supabase, type Consorcio, type Proveedor } from '@/lib/supabase';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/engine';

type Factura = { id: string; proveedor_id: string; consorcio_id: string; fecha: string; tipo_comprobante: string; comprobante: string | null; monto: number; descripcion: string | null; archivo_path: string | null; estado: 'recibida' | 'cargada' | 'rechazada'; motivo: string | null; gasto_id: string | null; created_at: string; proveedores?: Proveedor; consorcios?: Consorcio };
const TIPOS = ['Factura A', 'Factura B', 'Factura C', 'Factura M', 'Ticket', 'Recibo', 'Nota de crédito', 'Nota de débito', 'Otro'];

/** Facturas que los proveedores cargan desde el portal. Al aceptarlas pasan a Gastos pendientes con la factura adjunta. */
export function FacturasProveedores() {
  const [items, setItems] = useState<Factura[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [rechazar, setRechazar] = useState<Factura | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('proveedor_facturas').select('*, proveedores(*), consorcios(*)').order('created_at', { ascending: false }).limit(300);
    setItems((data as Factura[]) || []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const aceptar = async (f: Factura) => {
    setBusy(true); setMsg('');
    const { data: g, error } = await supabase.from('gastos').insert({
      consorcio_id: f.consorcio_id, liquidacion_id: null, proveedor_id: f.proveedor_id, descripcion: f.descripcion || f.proveedores?.nombre || 'Factura de proveedor',
      monto: f.monto, monto_a: f.monto, monto_b: 0, monto_c: 0, monto_d: 0, categoria: 'A', fecha: f.fecha,
      tipo_comprobante: TIPOS.includes(f.tipo_comprobante) ? f.tipo_comprobante : 'Otro', comprobante: f.comprobante, archivo_path: f.archivo_path, pagado: false,
      notas: 'Cargada por el proveedor desde el portal',
    }).select().single();
    if (error) { setBusy(false); return setMsg(error.message); }
    await supabase.from('proveedor_facturas').update({ estado: 'cargada', gasto_id: g.id }).eq('id', f.id);
    setBusy(false); setMsg(`Factura aceptada: quedó en Gastos pendientes de ${f.consorcios?.nombre || 'el consorcio'} para sumarla a una expensa y pagarla.`); load();
  };
  const confirmarRechazo = async () => {
    if (!rechazar) return;
    await supabase.from('proveedor_facturas').update({ estado: 'rechazada', motivo: motivo.trim() || null }).eq('id', rechazar.id);
    setRechazar(null); setMotivo(''); load();
  };

  const pend = items.filter((f) => f.estado === 'recibida').length;
  return (
    <div>
      <PageHeader title="Facturas recibidas de proveedores" subtitle="Los proveedores con mail cargado entran al portal, suben su factura y ven sus órdenes de pago. Acá las aceptás o rechazás." />
      {msg && <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 mb-4">{msg}</p>}
      {loading ? <Spinner /> : items.length === 0 ? <Card><EmptyState icon={<Inbox size={28} />} title="Sin facturas recibidas" subtitle="Cargale el mail a cada proveedor en su ficha y pasale el link del portal: entra con ese mail, sin contraseña." /></Card> : (
        <Card><Table headers={['Recibida', 'Proveedor', 'Consorcio', 'Comprobante', 'Fecha', 'Importe', 'Estado', '']}>
          {items.map((f) => (
            <tr key={f.id} className="hover:bg-slate-50">
              <Td>{fmtDate(f.created_at)}</Td><Td className="font-medium">{f.proveedores?.nombre}</Td><Td>{f.consorcios?.nombre}</Td>
              <Td>{f.tipo_comprobante} {f.comprobante || ''}{f.descripcion && <span className="block text-xs text-slate-400">{f.descripcion}</span>}</Td>
              <Td>{fmtDate(f.fecha)}</Td><Td className="text-right font-medium">{fmtMoney(f.monto)}</Td>
              <Td><Badge color={f.estado === 'recibida' ? 'amber' : f.estado === 'cargada' ? 'green' : 'red'}>{f.estado === 'recibida' ? 'A REVISAR' : f.estado === 'cargada' ? 'ACEPTADA' : 'RECHAZADA'}</Badge>{f.motivo && <span className="block text-xs text-slate-400">{f.motivo}</span>}</Td>
              <Td><div className="flex gap-1 items-center">
                {f.archivo_path && <a title="Ver factura" target="_blank" rel="noreferrer" href={supabase.storage.from('archivos').getPublicUrl(f.archivo_path).data.publicUrl} className="p-1.5 rounded text-slate-500 hover:bg-slate-100"><FileText size={14} /></a>}
                {f.estado === 'recibida' && <><Button size="sm" onClick={() => aceptar(f)} disabled={busy}><Check size={13} /> Aceptar</Button><Button size="sm" variant="secondary" onClick={() => { setMotivo(''); setRechazar(f); }}><X size={13} /> Rechazar</Button></>}
              </div></Td>
            </tr>
          ))}
        </Table></Card>
      )}
      {pend > 0 && <p className="text-xs text-slate-400 mt-2">{pend} a revisar.</p>}
      <Modal open={!!rechazar} onClose={() => setRechazar(null)} title="Rechazar factura" size="sm">
        <Input label="Motivo (lo ve el proveedor)" value={motivo} onChange={setMotivo} placeholder="Ej.: el importe no coincide con el presupuesto" />
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setRechazar(null)}>Cancelar</Button><Button variant="danger" onClick={confirmarRechazo}>Rechazar</Button></div>
      </Modal>
    </div>
  );
}

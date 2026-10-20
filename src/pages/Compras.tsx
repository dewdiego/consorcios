import { useEffect, useState } from 'react';
import { Award, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { supabase, type Cotizacion, type OrdenCompra, type PedidoCompra, type Proveedor } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, fmtMoney } from '@/lib/engine';

const estPedido: Record<string, 'amber' | 'blue' | 'green' | 'slate' | 'red'> = {
  abierto: 'amber', cotizando: 'blue', adjudicado: 'green', cerrado: 'slate', anulado: 'red',
};

/** Circuito de compras: pedido → cotizaciones de proveedores → se elige una → orden de compra. */
export function Compras() {
  const { consorcio } = useApp();
  const [tab, setTab] = useState('pedidos');
  const [pedidos, setPedidos] = useState<PedidoCompra[]>([]);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [pedidoModal, setPedidoModal] = useState(false);
  const [pedidoForm, setPedidoForm] = useState({ descripcion: '', detalle: '' });
  const [cotModal, setCotModal] = useState<PedidoCompra | null>(null);
  const [cotForm, setCotForm] = useState({ proveedor_id: '', monto: '', plazo_dias: '', notas: '' });
  const [deleteTarget, setDeleteTarget] = useState<PedidoCompra | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const { data: ps } = await supabase.from('pedidos_compra').select('*').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false });
    const pList = (ps as PedidoCompra[]) || [];
    setPedidos(pList);
    const ids = pList.map((p) => p.id);
    if (ids.length) {
      const [{ data: cs }, { data: os }] = await Promise.all([
        supabase.from('cotizaciones').select('*, proveedores(*), pedidos_compra(*)').in('pedido_id', ids).order('created_at'),
        supabase.from('ordenes_compra').select('*, pedidos_compra(*), cotizaciones(*, proveedores(*))').in('pedido_id', ids).order('created_at', { ascending: false }),
      ]);
      setCotizaciones((cs as Cotizacion[]) || []);
      setOrdenes((os as OrdenCompra[]) || []);
    } else { setCotizaciones([]); setOrdenes([]); }
    const { data: prs } = await supabase.from('proveedores').select('*').eq('activo', true).order('nombre');
    setProveedores((prs as Proveedor[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const crearPedido = async () => {
    if (!consorcio || !pedidoForm.descripcion.trim()) return;
    await supabase.from('pedidos_compra').insert({ consorcio_id: consorcio.id, descripcion: pedidoForm.descripcion.trim(), detalle: pedidoForm.detalle || null });
    setPedidoModal(false); setPedidoForm({ descripcion: '', detalle: '' });
    load();
  };

  const agregarCot = async () => {
    if (!cotModal || !cotForm.proveedor_id || !cotForm.monto) return;
    await supabase.from('cotizaciones').insert({
      pedido_id: cotModal.id, proveedor_id: cotForm.proveedor_id, monto: parseFloat(cotForm.monto),
      plazo_dias: cotForm.plazo_dias ? parseInt(cotForm.plazo_dias) : null, notas: cotForm.notas || null,
    });
    if (cotModal.estado === 'abierto') await supabase.from('pedidos_compra').update({ estado: 'cotizando' }).eq('id', cotModal.id);
    setCotModal(null); setCotForm({ proveedor_id: '', monto: '', plazo_dias: '', notas: '' });
    load();
  };

  /** Adjudicar: marca la cotización elegida, pasa el pedido a adjudicado y emite la orden de compra. */
  const adjudicar = async (c: Cotizacion) => {
    await supabase.from('cotizaciones').update({ elegida: false }).eq('pedido_id', c.pedido_id);
    await supabase.from('cotizaciones').update({ elegida: true }).eq('id', c.id);
    await supabase.from('pedidos_compra').update({ estado: 'adjudicado' }).eq('id', c.pedido_id);
    await supabase.from('ordenes_compra').insert({ pedido_id: c.pedido_id, cotizacion_id: c.id });
    load();
  };

  if (!consorcio) return null;

  return (
    <div>
      <PageHeader title={`Compras · ${consorcio.nombre}`} subtitle="Pedido → cotizaciones → adjudicación → orden de compra"
        action={<Button onClick={() => setPedidoModal(true)}><Plus size={16} /> Nuevo pedido</Button>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'pedidos', label: 'Pedidos de compra', badge: pedidos.length },
        { key: 'cotizaciones', label: 'Cotizaciones', badge: cotizaciones.length },
        { key: 'ordenes', label: 'Órdenes de compra', badge: ordenes.length },
      ]} />

      {loading ? <Spinner /> : tab === 'pedidos' ? (
        pedidos.length === 0 ? <Card><EmptyState icon={<ShoppingCart size={28} />} title="Sin pedidos de compra" /></Card> : (
          <Card>
            <Table headers={['N°', 'Fecha', 'Descripción', 'Cotizaciones', 'Estado', '']}>
              {pedidos.map((p) => {
                const cots = cotizaciones.filter((c) => c.pedido_id === p.id);
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <Td className="font-mono text-xs">PC-{String(p.numero).padStart(4, '0')}</Td>
                    <Td>{fmtDate(p.created_at.slice(0, 10))}</Td>
                    <Td className="font-medium max-w-sm">{p.descripcion}{p.detalle && <span className="block text-xs text-slate-400 truncate">{p.detalle}</span>}</Td>
                    <Td>{cots.length}</Td>
                    <Td><Badge color={estPedido[p.estado]}>{p.estado}</Badge></Td>
                    <Td>
                      <div className="flex gap-1">
                        {(p.estado === 'abierto' || p.estado === 'cotizando') && <Button size="sm" variant="secondary" onClick={() => setCotModal(p)}><Plus size={13} /> Cotización</Button>}
                        <button onClick={() => setDeleteTarget(p)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        )
      ) : tab === 'cotizaciones' ? (
        cotizaciones.length === 0 ? <Card><EmptyState icon={<Award size={28} />} title="Sin cotizaciones cargadas" subtitle="Agregalas desde la pestaña Pedidos." /></Card> : (
          <Card>
            <Table headers={['Pedido', 'Proveedor', 'Monto', 'Plazo', 'Notas', 'Estado', '']}>
              {cotizaciones.map((c) => {
                const pedido = pedidos.find((p) => p.id === c.pedido_id);
                return (
                  <tr key={c.id} className={`hover:bg-slate-50 ${c.elegida ? 'bg-emerald-50/40' : ''}`}>
                    <Td className="text-xs">PC-{String(pedido?.numero || '').padStart(4, '0')} · {pedido?.descripcion}</Td>
                    <Td className="font-medium">{c.proveedores?.nombre}</Td>
                    <Td className="font-semibold">{fmtMoney(Number(c.monto))}</Td>
                    <Td>{c.plazo_dias ? `${c.plazo_dias} días` : '—'}</Td>
                    <Td className="text-slate-500 text-xs max-w-xs truncate">{c.notas || '—'}</Td>
                    <Td>{c.elegida ? <Badge color="green">ADJUDICADA</Badge> : <Badge color="slate">en análisis</Badge>}</Td>
                    <Td>{!c.elegida && pedido?.estado !== 'cerrado' && pedido?.estado !== 'anulado' &&
                      <Button size="sm" onClick={() => adjudicar(c)}><Award size={13} /> Adjudicar</Button>}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        )
      ) : (
        ordenes.length === 0 ? <Card><EmptyState icon={<ShoppingCart size={28} />} title="Sin órdenes de compra" subtitle="Se generan al adjudicar una cotización." /></Card> : (
          <Card>
            <Table headers={['N°', 'Fecha', 'Pedido', 'Proveedor', 'Monto', 'Estado', '']}>
              {ordenes.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">OC-{String(o.numero).padStart(4, '0')}</Td>
                  <Td>{fmtDate(o.fecha)}</Td>
                  <Td className="max-w-sm truncate">{o.pedidos_compra?.descripcion}</Td>
                  <Td className="font-medium">{o.cotizaciones?.proveedores?.nombre || '—'}</Td>
                  <Td className="font-semibold">{fmtMoney(Number(o.cotizaciones?.monto || 0))}</Td>
                  <Td><Badge color={o.estado === 'facturada' ? 'green' : o.estado === 'anulada' ? 'red' : 'blue'}>{o.estado}</Badge></Td>
                  <Td>
                    {o.estado === 'emitida' && <Button size="sm" variant="secondary" onClick={async () => { await supabase.from('ordenes_compra').update({ estado: 'recibida' }).eq('id', o.id); load(); }}>Recibida</Button>}
                    {o.estado === 'recibida' && <Button size="sm" variant="secondary" onClick={async () => {
                      await supabase.from('ordenes_compra').update({ estado: 'facturada' }).eq('id', o.id);
                      await supabase.from('pedidos_compra').update({ estado: 'cerrado' }).eq('id', o.pedido_id);
                      // Regla: al facturar la OC se genera el gasto pendiente para la próxima liquidación
                      if (consorcio) await supabase.from('gastos').insert({
                        consorcio_id: consorcio.id, descripcion: `${o.pedidos_compra?.descripcion || 'Compra'} (OC-${String(o.numero).padStart(4, '0')})`,
                        categoria: 'A', monto: Number(o.cotizaciones?.monto || 0), proveedor_id: o.cotizaciones?.proveedor_id || null,
                      });
                      load();
                    }}>Facturada → genera gasto</Button>}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )
      )}

      <Modal open={pedidoModal} onClose={() => setPedidoModal(false)} title="Nuevo pedido de compra">
        <Input label="Descripción" value={pedidoForm.descripcion} onChange={(v) => setPedidoForm({ ...pedidoForm, descripcion: v })} required />
        <div className="mt-4"><Textarea label="Detalle" value={pedidoForm.detalle} onChange={(v) => setPedidoForm({ ...pedidoForm, detalle: v })} /></div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setPedidoModal(false)}>Cancelar</Button>
          <Button onClick={crearPedido}>Crear</Button>
        </div>
      </Modal>

      <Modal open={!!cotModal} onClose={() => setCotModal(null)} title={`Cotización para: ${cotModal?.descripcion || ''}`}>
        <Select label="Proveedor" value={cotForm.proveedor_id} onChange={(v) => setCotForm({ ...cotForm, proveedor_id: v })} placeholder="— Elegir —"
          options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} required />
        <div className="grid grid-cols-2 gap-4 mt-4">
          <Input label="Monto" type="number" step="0.01" value={cotForm.monto} onChange={(v) => setCotForm({ ...cotForm, monto: v })} required />
          <Input label="Plazo (días)" type="number" value={cotForm.plazo_dias} onChange={(v) => setCotForm({ ...cotForm, plazo_dias: v })} />
        </div>
        <div className="mt-4"><Input label="Notas" value={cotForm.notas} onChange={(v) => setCotForm({ ...cotForm, notas: v })} /></div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setCotModal(null)}>Cancelar</Button>
          <Button onClick={agregarCot}>Agregar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar pedido" message="¿Eliminar el pedido con sus cotizaciones y órdenes?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('pedidos_compra').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

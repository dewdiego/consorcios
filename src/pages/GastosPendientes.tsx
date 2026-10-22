import { useEffect, useState } from 'react';
import { Link2, Plus, Receipt, Trash2 } from 'lucide-react';
import { supabase, type Gasto, type Liquidacion, type Proveedor, type Rubro } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { GastoModal } from '@/components/GastoModal';
import { CATEGORIAS, fmtDate, fmtMoney, hoyISO } from '@/lib/engine';

/** Gastos cargados que todavía no fueron vinculados a ninguna liquidación. */
export function GastosPendientes() {
  const { consorcio } = useApp();
  const [items, setItems] = useState<Gasto[]>([]);
  const [abiertas, setAbiertas] = useState<Liquidacion[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ descripcion: '', proveedor_id: '', rubro_id: '', categoria: 'A', monto: '', fecha: hoyISO(), comprobante: '', cae: '' });
  const [deleteTarget, setDeleteTarget] = useState<Gasto | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [g, l, pr, r] = await Promise.all([
      supabase.from('gastos').select('*, proveedores(*), rubros(*)').eq('consorcio_id', consorcio.id).is('liquidacion_id', null).order('fecha', { ascending: false }),
      supabase.from('liquidaciones').select('*').eq('consorcio_id', consorcio.id).eq('estado', 'abierta').order('periodo', { ascending: false }),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('rubros').select('*').order('orden'),
    ]);
    setItems((g.data as Gasto[]) || []);
    setAbiertas((l.data as Liquidacion[]) || []);
    setProveedores((pr.data as Proveedor[]) || []);
    setRubros((r.data as Rubro[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const save = async () => {
    if (!consorcio) return;
    if (!form.descripcion.trim() || !form.monto) { setError('Completá descripción y monto.'); return; }
    const { error: err } = await supabase.from('gastos').insert({
      consorcio_id: consorcio.id, liquidacion_id: null,
      proveedor_id: form.proveedor_id || null, rubro_id: form.rubro_id || null,
      descripcion: form.descripcion.trim(), categoria: form.categoria,
      monto: parseFloat(form.monto), fecha: form.fecha, comprobante: form.comprobante || null, cae: form.cae || null,
    });
    if (err) { setError(err.message); return; }
    setModal(false);
    setForm({ descripcion: '', proveedor_id: '', rubro_id: '', categoria: 'A', monto: '', fecha: hoyISO(), comprobante: '', cae: '' });
    load();
  };

  const vincular = async (g: Gasto, liqId: string) => {
    await supabase.from('gastos').update({ liquidacion_id: liqId }).eq('id', g.id);
    load();
  };

  if (!consorcio) return null;
  const total = items.reduce((a, g) => a + Number(g.monto), 0);

  return (
    <div>
      <PageHeader title={`Gastos pendientes · ${consorcio.nombre}`}
        subtitle={`Gastos aún no vinculados a una liquidación · Total ${fmtMoney(total)}`}
        action={<Button onClick={() => { setError(''); setModal(true); }}><Plus size={16} /> Nuevo gasto</Button>} />

      {abiertas.length === 0 && items.length > 0 && (
        <div className="bg-amber-50 text-amber-700 text-sm rounded-lg px-4 py-2.5 mb-4">
          No hay ninguna liquidación abierta: creá una en Expensas → Liquidaciones para poder vincular estos gastos.
        </div>
      )}

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<Receipt size={28} />} title="No hay gastos sin vincular" subtitle="Todo gasto cargado acá queda esperando que lo vincules a un período." /></Card>
      ) : (
        <Card>
          <Table headers={['Fecha', 'Descripción', 'Rubro', 'Proveedor', 'Cat.', 'Monto', 'Vincular a período', '']}>
            {items.map((g) => (
              <tr key={g.id} className="hover:bg-slate-50">
                <Td>{fmtDate(g.fecha)}</Td>
                <Td className="font-medium max-w-xs truncate">{g.descripcion}</Td>
                <Td className="text-slate-500">{g.rubros?.nombre || '—'}</Td>
                <Td className="text-slate-500">{g.proveedores?.nombre || '—'}</Td>
                <Td><Badge color="teal">{g.categoria}</Badge></Td>
                <Td className="font-semibold">{fmtMoney(Number(g.monto))}</Td>
                <Td>
                  {abiertas.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <Link2 size={13} className="text-slate-400" />
                      <select className="text-xs border border-slate-200 rounded-lg px-2 py-1.5" defaultValue=""
                        onChange={(e) => e.target.value && vincular(g, e.target.value)}>
                        <option value="">Elegir…</option>
                        {abiertas.map((l) => <option key={l.id} value={l.id}>{l.periodo}</option>)}
                      </select>
                    </div>
                  ) : <span className="text-xs text-slate-300">sin liq. abierta</span>}
                </Td>
                <Td><button onClick={() => setDeleteTarget(g)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <GastoModal open={modal} onClose={() => setModal(false)}
        consorcioId={consorcio.id} liquidacionId={null} onSaved={load} />

      <ConfirmDialog open={!!deleteTarget} title="Eliminar gasto" message={`¿Eliminar "${deleteTarget?.descripcion}"?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('gastos').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}
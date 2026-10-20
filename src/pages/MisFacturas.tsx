import { useEffect, useState } from 'react';
import { FileText, Plus, Trash2, Zap } from 'lucide-react';
import { supabase, type FacturaAdmin } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, fmtMoney, hoyISO, periodoActual } from '@/lib/engine';

/** Facturación propia de la administración: honorarios emitidos a los consorcios y facturas recibidas. */
export function MisFacturas() {
  const { consorcios } = useApp();
  const [tab, setTab] = useState('emitida');
  const [items, setItems] = useState<FacturaAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ consorcio_id: '', periodo: periodoActual(), concepto: '', numero: '', monto: '', fecha: hoyISO() });
  const [deleteTarget, setDeleteTarget] = useState<FacturaAdmin | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('facturas_admin').select('*, consorcios(*)').order('fecha', { ascending: false });
    setItems((data as FacturaAdmin[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const visibles = items.filter((f) => f.tipo === tab);

  const crear = async () => {
    if (!form.concepto.trim() || !form.monto) return;
    await supabase.from('facturas_admin').insert({
      tipo: tab, consorcio_id: form.consorcio_id || null, periodo: form.periodo || null,
      concepto: form.concepto.trim(), numero: form.numero || null, monto: parseFloat(form.monto), fecha: form.fecha,
    });
    setModal(false);
    setForm({ consorcio_id: '', periodo: periodoActual(), concepto: '', numero: '', monto: '', fecha: hoyISO() });
    load();
  };

  /** Genera una factura de honorarios del período por cada consorcio activo con honorarios > 0. */
  const generarHonorarios = async () => {
    const periodo = periodoActual();
    let n = 0;
    for (const c of consorcios.filter((x) => x.activo && Number(x.honorarios_mensuales) > 0)) {
      if (items.some((f) => f.tipo === 'emitida' && f.consorcio_id === c.id && f.periodo === periodo)) continue;
      await supabase.from('facturas_admin').insert({
        tipo: 'emitida', consorcio_id: c.id, periodo, concepto: `Honorarios administración ${periodo}`,
        monto: c.honorarios_mensuales, fecha: hoyISO(),
      });
      n++;
    }
    setMsg(n > 0 ? `Se generaron ${n} facturas de honorarios de ${periodo}.` : 'Nada para generar: ya existen, o ningún consorcio tiene honorarios configurados.');
    load();
  };

  const marcarPagada = async (f: FacturaAdmin) => {
    await supabase.from('facturas_admin').update({ estado: 'pagada' }).eq('id', f.id);
    load();
  };

  return (
    <div>
      <PageHeader title="Mis Facturas" subtitle="Honorarios emitidos a consorcios y facturas recibidas de la administración"
        action={<div className="flex gap-2">
          {tab === 'emitida' && <Button variant="secondary" onClick={generarHonorarios}><Zap size={15} /> Generar honorarios del mes</Button>}
          <Button onClick={() => setModal(true)}><Plus size={16} /> Nueva</Button>
        </div>} />
      {msg && <div className="bg-emerald-50 text-emerald-700 text-sm rounded-lg px-4 py-2.5 mb-4">{msg}</div>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'emitida', label: 'Emitidas', badge: items.filter((i) => i.tipo === 'emitida').length },
        { key: 'recibida', label: 'Recibidas', badge: items.filter((i) => i.tipo === 'recibida').length },
      ]} />

      {loading ? <Spinner /> : visibles.length === 0 ? (
        <Card><EmptyState icon={<FileText size={28} />} title={`Sin facturas ${tab === 'emitida' ? 'emitidas' : 'recibidas'}`} /></Card>
      ) : (
        <Card>
          <Table headers={['Fecha', 'N°', 'Consorcio', 'Período', 'Concepto', 'Monto', 'Estado', '']}>
            {visibles.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <Td>{fmtDate(f.fecha)}</Td>
                <Td className="font-mono text-xs">{f.numero || '—'}</Td>
                <Td className="font-medium">{f.consorcios?.nombre || '—'}</Td>
                <Td>{f.periodo || '—'}</Td>
                <Td className="max-w-xs truncate">{f.concepto}</Td>
                <Td className="font-semibold">{fmtMoney(Number(f.monto))}</Td>
                <Td><Badge color={f.estado === 'pagada' ? 'green' : f.estado === 'anulada' ? 'slate' : 'amber'}>{f.estado}</Badge></Td>
                <Td>
                  <div className="flex gap-1">
                    {f.estado === 'pendiente' && <Button size="sm" variant="secondary" onClick={() => marcarPagada(f)}>Pagada</Button>}
                    <button onClick={() => setDeleteTarget(f)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={`Nueva factura ${tab === 'emitida' ? 'emitida' : 'recibida'}`}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Consorcio" value={form.consorcio_id} onChange={(v) => setForm({ ...form, consorcio_id: v })} placeholder="— Sin consorcio —"
            options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} />
          <Input label="Período" type="month" value={form.periodo} onChange={(v) => setForm({ ...form, periodo: v })} />
          <div className="col-span-2"><Input label="Concepto" value={form.concepto} onChange={(v) => setForm({ ...form, concepto: v })} required /></div>
          <Input label="N° factura" value={form.numero} onChange={(v) => setForm({ ...form, numero: v })} />
          <Input label="Monto" type="number" step="0.01" value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} required />
          <Input label="Fecha" type="date" value={form.fecha} onChange={(v) => setForm({ ...form, fecha: v })} />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={crear}>Guardar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar factura" message={`¿Eliminar "${deleteTarget?.concepto}"?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('facturas_admin').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

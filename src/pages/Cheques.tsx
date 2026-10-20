import { useEffect, useState } from 'react';
import { CreditCard, Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Cheque } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, fmtMoney, hoyISO } from '@/lib/engine';

const estados = ['en_cartera', 'entregado', 'depositado', 'debitado', 'rechazado', 'anulado'];
const estadoColor: Record<string, 'teal' | 'blue' | 'green' | 'amber' | 'red' | 'slate'> = {
  en_cartera: 'teal', entregado: 'blue', depositado: 'amber', debitado: 'green', rechazado: 'red', anulado: 'slate',
};

export function Cheques() {
  const { consorcio } = useApp();
  const [items, setItems] = useState<Cheque[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Cheque | null>(null);
  const [form, setForm] = useState({ banco: '', numero: '', monto: '', fecha_emision: hoyISO(), fecha_cobro: '', origen: 'propio', estado: 'en_cartera', destino: '' });
  const [deleteTarget, setDeleteTarget] = useState<Cheque | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const { data } = await supabase.from('cheques').select('*').eq('consorcio_id', consorcio.id).order('fecha_emision', { ascending: false });
    setItems((data as Cheque[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const openNew = () => { setEditing(null); setForm({ banco: '', numero: '', monto: '', fecha_emision: hoyISO(), fecha_cobro: '', origen: 'propio', estado: 'en_cartera', destino: '' }); setModal(true); };
  const openEdit = (c: Cheque) => {
    setEditing(c);
    setForm({ banco: c.banco, numero: c.numero, monto: String(c.monto), fecha_emision: c.fecha_emision, fecha_cobro: c.fecha_cobro || '', origen: c.origen, estado: c.estado, destino: c.destino || '' });
    setModal(true);
  };

  const save = async () => {
    if (!consorcio || !form.banco.trim() || !form.numero.trim()) return;
    const payload = {
      consorcio_id: consorcio.id, banco: form.banco.trim(), numero: form.numero.trim(),
      monto: parseFloat(form.monto) || 0, fecha_emision: form.fecha_emision, fecha_cobro: form.fecha_cobro || null,
      origen: form.origen, estado: form.estado, destino: form.destino || null,
    };
    const q = editing ? supabase.from('cheques').update(payload).eq('id', editing.id) : supabase.from('cheques').insert(payload);
    await q;
    setModal(false); load();
  };

  if (!consorcio) return null;
  const enCartera = items.filter((c) => c.estado === 'en_cartera').reduce((a, c) => a + Number(c.monto), 0);

  return (
    <div>
      <PageHeader title={`Gestión de cheques · ${consorcio.nombre}`} subtitle={`En cartera: ${fmtMoney(enCartera)}`}
        action={<Button onClick={openNew}><Plus size={16} /> Nuevo cheque</Button>} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<CreditCard size={28} />} title="Sin cheques registrados" /></Card>
      ) : (
        <Card>
          <Table headers={['Banco', 'N°', 'Origen', 'Emisión', 'Cobro', 'Destino', 'Monto', 'Estado', '']}>
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td className="font-medium">{c.banco}</Td>
                <Td className="font-mono text-xs">{c.numero}</Td>
                <Td className="capitalize">{c.origen}</Td>
                <Td>{fmtDate(c.fecha_emision)}</Td>
                <Td>{fmtDate(c.fecha_cobro)}</Td>
                <Td className="text-slate-500">{c.destino || '—'}</Td>
                <Td className="font-semibold">{fmtMoney(Number(c.monto))}</Td>
                <Td><Badge color={estadoColor[c.estado] || 'slate'}>{c.estado.replace('_', ' ')}</Badge></Td>
                <Td>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                    <button onClick={() => setDeleteTarget(c)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar cheque' : 'Nuevo cheque'}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Banco" value={form.banco} onChange={(v) => setForm({ ...form, banco: v })} required />
          <Input label="Número" value={form.numero} onChange={(v) => setForm({ ...form, numero: v })} required />
          <Input label="Monto" type="number" step="0.01" value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} required />
          <Select label="Origen" value={form.origen} onChange={(v) => setForm({ ...form, origen: v })}
            options={[{ value: 'propio', label: 'Propio (emitido)' }, { value: 'recibido', label: 'Recibido (de tercero)' }]} />
          <Input label="Fecha emisión" type="date" value={form.fecha_emision} onChange={(v) => setForm({ ...form, fecha_emision: v })} />
          <Input label="Fecha de cobro" type="date" value={form.fecha_cobro} onChange={(v) => setForm({ ...form, fecha_cobro: v })} />
          <Select label="Estado" value={form.estado} onChange={(v) => setForm({ ...form, estado: v })}
            options={estados.map((e) => ({ value: e, label: e.replace('_', ' ') }))} />
          <Input label="Destino / entregado a" value={form.destino} onChange={(v) => setForm({ ...form, destino: v })} />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={save}>Guardar</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} title="Eliminar cheque" message={`¿Eliminar el cheque ${deleteTarget?.numero} de ${deleteTarget?.banco}?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) { await supabase.from('cheques').delete().eq('id', deleteTarget.id); setDeleteTarget(null); load(); } }} />
    </div>
  );
}

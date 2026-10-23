import { useEffect, useMemo, useState } from 'react';
import { Download, Home, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { supabase, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { exportCSV, fmtPct } from '@/lib/engine';
import { emailsConApp } from '@/lib/config';

type Form = {
  uf: string; depto: string; piso: string; superficie_m2: string;
  propietario: string; propietario_telefono: string; propietario_email: string; propietario_dni: string;
  alquilada: boolean; inquilino: string; inquilino_telefono: string; inquilino_email: string;
  coef_a: string; coef_b: string; coef_c: string; coef_d: string; activo: boolean;
};

const empty: Form = {
  uf: '', depto: '', piso: '', superficie_m2: '0',
  propietario: '', propietario_telefono: '', propietario_email: '', propietario_dni: '',
  alquilada: false, inquilino: '', inquilino_telefono: '', inquilino_email: '',
  coef_a: '0', coef_b: '0', coef_c: '0', coef_d: '0', activo: true,
};

export function Unidades() {
  const { consorcio } = useApp();
  const [items, setItems] = useState<Unidad[]>([]);
  const [conApp, setConApp] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [fUF, setFUF] = useState('');
  const [fProp, setFProp] = useState('');
  const [mostrarAlquileres, setMostrarAlquileres] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Unidad | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Unidad | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [{ data }, app] = await Promise.all([supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).order('uf'), emailsConApp(supabase)]);
    setItems((data as Unidad[]) || []);
    setConApp(app);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const visibles = items
    .filter((u) => !fUF || String(u.uf).includes(fUF))
    .filter((u) => !fProp || (u.propietario || '').toLowerCase().includes(fProp.toLowerCase()) || (u.depto || '').toLowerCase().includes(fProp.toLowerCase()));

  const sumas = useMemo(() => {
    const act = items.filter((u) => u.activo);
    return {
      a: act.reduce((s, u) => s + Number(u.coef_a), 0),
      b: act.reduce((s, u) => s + Number(u.coef_b), 0),
      c: act.reduce((s, u) => s + Number(u.coef_c), 0),
      d: act.reduce((s, u) => s + Number(u.coef_d), 0),
    };
  }, [items]);

  const sumBadge = (v: number) => {
    const ok = Math.abs(v - 100) <= 0.05;
    const vacio = v === 0;
    return <Badge color={ok ? 'green' : vacio ? 'slate' : 'red'}>{fmtPct(v)}</Badge>;
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty, uf: String((items.reduce((m, u) => Math.max(m, u.uf), 0) || 0) + 1) });
    setError(''); setModal(true);
  };
  const openEdit = (u: Unidad) => {
    setEditing(u); setError('');
    setForm({
      uf: String(u.uf), depto: u.depto, piso: u.piso || '', superficie_m2: String(u.superficie_m2),
      propietario: u.propietario || '', propietario_telefono: u.propietario_telefono || '',
      propietario_email: u.propietario_email || '', propietario_dni: u.propietario_dni || '',
      alquilada: u.alquilada, inquilino: u.inquilino || '', inquilino_telefono: u.inquilino_telefono || '',
      inquilino_email: u.inquilino_email || '',
      coef_a: String(u.coef_a), coef_b: String(u.coef_b), coef_c: String(u.coef_c), coef_d: String(u.coef_d),
      activo: u.activo,
    });
    setModal(true);
  };

  const save = async () => {
    if (!consorcio) return;
    if (!form.uf || !form.depto.trim()) { setError('UF y Depto. son obligatorios.'); return; }
    setSaving(true); setError('');
    const payload = {
      consorcio_id: consorcio.id, uf: parseInt(form.uf), depto: form.depto.trim(), piso: form.piso || null,
      superficie_m2: parseFloat(form.superficie_m2) || 0,
      propietario: form.propietario || null, propietario_telefono: form.propietario_telefono || null,
      propietario_email: form.propietario_email || null, propietario_dni: form.propietario_dni || null,
      alquilada: form.alquilada, inquilino: form.alquilada ? form.inquilino || null : null,
      inquilino_telefono: form.alquilada ? form.inquilino_telefono || null : null,
      inquilino_email: form.alquilada ? form.inquilino_email || null : null,
      coef_a: parseFloat(form.coef_a) || 0, coef_b: parseFloat(form.coef_b) || 0,
      coef_c: parseFloat(form.coef_c) || 0, coef_d: parseFloat(form.coef_d) || 0,
      activo: form.activo,
    };
    const q = editing ? supabase.from('unidades').update(payload).eq('id', editing.id) : supabase.from('unidades').insert(payload);
    const { error: err } = await q;
    setSaving(false);
    if (err) { setError(err.code === '23505' ? `Ya existe la UF ${form.uf} en este consorcio.` : err.message); return; }
    setModal(false); load();
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    await supabase.from('unidades').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null); load();
  };

  const exportar = () => {
    exportCSV(`unidades_${consorcio?.nombre || ''}.csv`,
      ['UF', 'Depto', 'Piso', 'Propietario', 'Tel', 'Email', 'Alquilada', 'Inquilino', 'Coef A', 'Coef B', 'Coef C', 'Coef D', 'Activa'],
      items.map((u) => [u.uf, u.depto, u.piso, u.propietario, u.propietario_telefono, u.propietario_email,
        u.alquilada ? 'SI' : 'NO', u.inquilino, u.coef_a, u.coef_b, u.coef_c, u.coef_d, u.activo ? 'SI' : 'NO']));
  };

  const importar = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !consorcio) return;
      const text = await file.text();
      const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
      const sep = lines[0].includes(';') ? ';' : ',';
      const rows = lines.slice(1).map((l) => l.split(sep));
      const payload = rows.filter((r) => r[0]).map((r) => ({
        consorcio_id: consorcio.id, uf: parseInt(r[0]), depto: r[1] || `UF ${r[0]}`, piso: r[2] || null,
        propietario: r[3] || null, propietario_telefono: r[4] || null, propietario_email: r[5] || null,
        alquilada: (r[6] || '').toUpperCase().startsWith('S'), inquilino: r[7] || null,
        coef_a: parseFloat((r[8] || '0').replace(',', '.')) || 0, coef_b: parseFloat((r[9] || '0').replace(',', '.')) || 0,
        coef_c: parseFloat((r[10] || '0').replace(',', '.')) || 0, coef_d: parseFloat((r[11] || '0').replace(',', '.')) || 0,
      }));
      if (payload.length === 0) { alert('No se encontraron filas válidas. Formato: UF;Depto;Piso;Propietario;Tel;Email;Alquilada;Inquilino;CoefA;CoefB;CoefC;CoefD'); return; }
      const { error: err } = await supabase.from('unidades').upsert(payload, { onConflict: 'consorcio_id,uf' });
      if (err) alert(`Error al importar: ${err.message}`); else load();
    };
    input.click();
  };

  if (!consorcio) return null;

  return (
    <div>
      <PageHeader title={`Unidades · ${consorcio.nombre}`} subtitle="Coeficientes de prorrateo por categoría (deben sumar 100% por columna)"
        action={<div className="flex gap-2">
          <Button variant="secondary" onClick={importar}><Upload size={15} /> Importar</Button>
          <Button variant="secondary" onClick={exportar}><Download size={15} /> Exportar</Button>
          <Button onClick={openNew}><Plus size={16} /> Nueva unidad</Button>
        </div>} />

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28"><Input label="UF" value={fUF} onChange={setFUF} placeholder="N°" /></div>
          <div className="w-64"><Input label="Depto. o Propietario" value={fProp} onChange={setFProp} placeholder="Buscar…" /></div>
          <label className="flex items-center gap-2 text-sm text-slate-600 pb-2.5">
            <input type="checkbox" checked={mostrarAlquileres} onChange={(e) => setMostrarAlquileres(e.target.checked)} className="rounded" />
            Mostrar alquileres
          </label>
        </div>
      </Card>

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<Home size={28} />} title="Sin unidades cargadas" subtitle="Cargá las UF con sus coeficientes, o importalas desde un CSV." /></Card>
      ) : (
        <Card>
          <Table headers={['UF', 'Depto.', 'Propietario', ...(mostrarAlquileres ? ['Inquilino'] : []),
            <span key="a">A · Exp. ordinarias {sumBadge(sumas.a)}</span>,
            <span key="b">B · Cocheras {sumBadge(sumas.b)}</span>,
            <span key="c">C · Cuota extr. {sumBadge(sumas.c)}</span>,
            <span key="d">D · Gastos {sumBadge(sumas.d)}</span>, 'Acciones']}>
            {visibles.map((u) => (
              <tr key={u.id} className={`hover:bg-slate-50 ${!u.activo ? 'opacity-50' : ''}`}>
                <Td className="font-mono text-xs">{String(u.uf).padStart(3, '0')}</Td>
                <Td className="font-medium">{u.depto}{!u.activo && <Badge color="slate">inactiva</Badge>}</Td>
                <Td>{u.propietario || <span className="text-slate-300">—</span>}{u.alquilada && <Badge color="blue">alquilada</Badge>}
                  {(conApp.has((u.propietario_email || '').toLowerCase()) || conApp.has((u.inquilino_email || '').toLowerCase())) && <span title="Tiene la app instalada" className="ml-1">📱</span>}</Td>
                {mostrarAlquileres && <Td>{u.inquilino || <span className="text-slate-300">—</span>}</Td>}
                <Td>{fmtPct(Number(u.coef_a))}</Td>
                <Td>{fmtPct(Number(u.coef_b))}</Td>
                <Td>{fmtPct(Number(u.coef_c))}</Td>
                <Td>{fmtPct(Number(u.coef_d))}</Td>
                <Td>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(u)} className="p-1.5 rounded text-teal-600 hover:bg-teal-50" title="Editar"><Pencil size={14} /></button>
                    <button onClick={() => setDeleteTarget(u)} className="p-1.5 rounded text-red-400 hover:bg-red-50" title="Eliminar"><Trash2 size={14} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Editar UF ${editing.uf}` : 'Nueva unidad'} size="lg">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Input label="UF N°" type="number" value={form.uf} onChange={(v) => setForm({ ...form, uf: v })} required />
          <Input label="Depto." value={form.depto} onChange={(v) => setForm({ ...form, depto: v })} placeholder="1-2" required />
          <Input label="Piso" value={form.piso} onChange={(v) => setForm({ ...form, piso: v })} />
          <Input label="Superficie m²" type="number" step="0.01" value={form.superficie_m2} onChange={(v) => setForm({ ...form, superficie_m2: v })} />
        </div>
        <p className="text-sm font-semibold text-slate-700 mt-5 mb-3">Propietario</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Nombre" value={form.propietario} onChange={(v) => setForm({ ...form, propietario: v })} />
          <Input label="DNI" value={form.propietario_dni} onChange={(v) => setForm({ ...form, propietario_dni: v })} />
          <Input label="Teléfono" value={form.propietario_telefono} onChange={(v) => setForm({ ...form, propietario_telefono: v })} />
          <Input label="Email" value={form.propietario_email} onChange={(v) => setForm({ ...form, propietario_email: v })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 mt-4">
          <input type="checkbox" checked={form.alquilada} onChange={(e) => setForm({ ...form, alquilada: e.target.checked })} className="rounded" />
          Unidad alquilada
        </label>
        {form.alquilada && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
            <Input label="Inquilino" value={form.inquilino} onChange={(v) => setForm({ ...form, inquilino: v })} />
            <Input label="Teléfono" value={form.inquilino_telefono} onChange={(v) => setForm({ ...form, inquilino_telefono: v })} />
            <Input label="Email" value={form.inquilino_email} onChange={(v) => setForm({ ...form, inquilino_email: v })} />
          </div>
        )}
        <p className="text-sm font-semibold text-slate-700 mt-5 mb-1">Coeficientes de prorrateo (%)</p>
        <p className="text-xs text-slate-400 mb-3">Porcentaje de cada categoría de gasto que paga esta unidad. La suma de cada columna entre todas las UF activas debe dar 100%.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Input label="A · Exp. ordinarias" type="number" step="0.0001" value={form.coef_a} onChange={(v) => setForm({ ...form, coef_a: v })} />
          <Input label="B · Cocheras" type="number" step="0.0001" value={form.coef_b} onChange={(v) => setForm({ ...form, coef_b: v })} />
          <Input label="C · Cuota extraord." type="number" step="0.0001" value={form.coef_c} onChange={(v) => setForm({ ...form, coef_c: v })} />
          <Input label="D · Gastos partic." type="number" step="0.0001" value={form.coef_d} onChange={(v) => setForm({ ...form, coef_d: v })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 mt-4">
          <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="rounded" />
          Unidad activa (entra en las liquidaciones)
        </label>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={doDelete}
        title="Eliminar unidad"
        message={`¿Eliminar la UF ${deleteTarget?.uf} (${deleteTarget?.depto})? Se borran también sus cupones y pagos.`} />
    </div>
  );
}

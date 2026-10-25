import { useEffect, useState } from 'react';
import { Building2, Megaphone, Home, Users as UsersIcon, DollarSign, FileUp, FolderOpen, Plus, Pencil, Search } from 'lucide-react';
import { supabase, type Consorcio } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, Input, Modal, PageHeader, Spinner } from '@/components/ui';
import type { PageKey } from '@/components/Layout';
import { ImportarLiquidacion } from '@/components/ImportarLiquidacion';
import { LegajoConsorcio } from '@/components/LegajoConsorcio';

type Form = {
  nombre: string; direccion: string; ciudad: string; cuit: string; telefono: string; email: string;
  cantidad_pisos: string; dia_vencimiento_1: string; dia_vencimiento_2: string;
  recargo_2do_venc_pct: string; interes_mora_mensual_pct: string; honorarios_mensuales: string;
  activo: boolean; notas: string;
};

const empty: Form = {
  nombre: '', direccion: '', ciudad: '', cuit: '', telefono: '', email: '', cantidad_pisos: '0',
  dia_vencimiento_1: '10', dia_vencimiento_2: '20', recargo_2do_venc_pct: '2',
  interes_mora_mensual_pct: '0', honorarios_mensuales: '0', activo: true, notas: '',
};

export function Consorcios({ onNavigate }: { onNavigate?: (p: PageKey) => void }) {
  const { reloadConsorcios, setConsorcioId } = useApp();
  const [items, setItems] = useState<Consorcio[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'activos' | 'inactivos'>('activos');
  const [busqueda, setBusqueda] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Consorcio | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importar, setImportar] = useState(false);
  const [legajo, setLegajo] = useState<Consorcio | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: us }] = await Promise.all([
      supabase.from('consorcios').select('*').order('nombre'),
      supabase.from('unidades').select('consorcio_id'),
    ]);
    setItems((data as Consorcio[]) || []);
    const c: Record<string, number> = {};
    for (const u of us || []) c[u.consorcio_id] = (c[u.consorcio_id] || 0) + 1;
    setCounts(c);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const visibles = items.filter((c) => (filtro === 'activos' ? c.activo : !c.activo))
    .filter((c) => c.nombre.toLowerCase().includes(busqueda.toLowerCase()));

  const openNew = () => { setEditing(null); setForm(empty); setError(''); setModal(true); };
  const openEdit = (c: Consorcio) => {
    setEditing(c); setError('');
    setForm({
      nombre: c.nombre, direccion: c.direccion || '', ciudad: c.ciudad || '', cuit: c.cuit || '',
      telefono: c.telefono || '', email: c.email || '', cantidad_pisos: String(c.cantidad_pisos),
      dia_vencimiento_1: String(c.dia_vencimiento_1), dia_vencimiento_2: String(c.dia_vencimiento_2),
      recargo_2do_venc_pct: String(c.recargo_2do_venc_pct), interes_mora_mensual_pct: String(c.interes_mora_mensual_pct),
      honorarios_mensuales: String(c.honorarios_mensuales), activo: c.activo, notas: c.notas || '',
    });
    setModal(true);
  };

  const save = async () => {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    const v1 = parseInt(form.dia_vencimiento_1), v2 = parseInt(form.dia_vencimiento_2);
    if (v2 <= v1) { setError('El 2º vencimiento debe ser posterior al 1º.'); return; }
    setSaving(true); setError('');
    const payload = {
      nombre: form.nombre.trim(), direccion: form.direccion || null, ciudad: form.ciudad || null,
      cuit: form.cuit || null, telefono: form.telefono || null, email: form.email || null,
      cantidad_pisos: parseInt(form.cantidad_pisos) || 0,
      dia_vencimiento_1: v1 || 10, dia_vencimiento_2: v2 || 20,
      recargo_2do_venc_pct: parseFloat(form.recargo_2do_venc_pct) || 0,
      interes_mora_mensual_pct: parseFloat(form.interes_mora_mensual_pct) || 0,
      honorarios_mensuales: parseFloat(form.honorarios_mensuales) || 0,
      activo: form.activo, notas: form.notas || null,
    };
    const q = editing
      ? supabase.from('consorcios').update(payload).eq('id', editing.id)
      : supabase.from('consorcios').insert(payload);
    const { error: err } = await q;
    setSaving(false);
    if (err) { setError(err.message); return; }
    setModal(false);
    await Promise.all([load(), reloadConsorcios()]);
  };

  const irA = (c: Consorcio, page: PageKey) => { setConsorcioId(c.id); onNavigate?.(page); };

  return (
    <div>
      <PageHeader title="Consorcios" subtitle="Edificios administrados"
        action={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImportar(true)}><FileUp size={15} /> Importar desde PDF</Button>
          <Button onClick={openNew}><Plus size={16} /> Nuevo</Button>
        </div>} />
      <ImportarLiquidacion open={importar} onClose={() => setImportar(false)} consorcioId={null}
        onImportado={async (cid) => { await load(); setConsorcioId(cid); }} />

      <Card className="p-4 mb-5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre de edificio"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          </div>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <button onClick={() => setFiltro('activos')} className={filtro === 'activos' ? 'text-red-500' : 'text-slate-400'}>🔓 ACTIVOS ({items.filter((i) => i.activo).length})</button>
            <button onClick={() => setFiltro('inactivos')} className={filtro === 'inactivos' ? 'text-red-500' : 'text-slate-400'}>🔒 INACTIVOS ({items.filter((i) => !i.activo).length})</button>
          </div>
        </div>
      </Card>

      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibles.map((c) => (
            <Card key={c.id} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-1">
                <p className="font-semibold text-slate-800 text-sm truncate pr-2" title={c.nombre}>{c.nombre.toUpperCase()}</p>
                <span className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${c.activo ? 'bg-teal-400' : 'bg-slate-300'}`} />
              </div>
              <p className="text-xs text-slate-400 truncate">{c.direccion || 'Sin dirección'}</p>
              <p className="text-xs text-slate-400 mb-3">{counts[c.id] || 0} unidades · Venc. {c.dia_vencimiento_1} y {c.dia_vencimiento_2}</p>
              <div className="flex items-center gap-1.5">
                <button title="Noticias" onClick={() => irA(c, 'noticias')} className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-teal-50 hover:text-teal-600"><Megaphone size={14} /></button>
                <button title="Unidades" onClick={() => irA(c, 'unidades')} className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-teal-50 hover:text-teal-600"><Home size={14} /></button>
                <button title="Cuentas corrientes" onClick={() => irA(c, 'exp_ctacte')} className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-teal-50 hover:text-teal-600"><UsersIcon size={14} /></button>
                <button title="Expensas" onClick={() => irA(c, 'exp_liquidaciones')} className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-teal-50 hover:text-teal-600"><DollarSign size={14} /></button>
                <button title="Legajo (CUIT, banco, pólizas)" onClick={() => setLegajo(c)} className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-teal-50 hover:text-teal-600"><FolderOpen size={14} /></button>
                <div className="flex-1" />
                <button title="Editar" onClick={() => openEdit(c)} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"><Pencil size={14} /></button>
              </div>
            </Card>
          ))}
          {visibles.length === 0 && (
            <Card className="p-10 col-span-full text-center text-slate-400">
              <Building2 size={32} className="mx-auto mb-2 text-slate-300" />
              No hay consorcios {filtro} {busqueda && 'con ese nombre'}.
            </Card>
          )}
        </div>
      )}

      <LegajoConsorcio consorcio={legajo} open={!!legajo} onClose={() => setLegajo(null)} onGuardado={async () => { await Promise.all([load(), reloadConsorcios()]); }} />

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar consorcio' : 'Nuevo consorcio'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><Input label="Nombre" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} required /></div>
          <Input label="Dirección" value={form.direccion} onChange={(v) => setForm({ ...form, direccion: v })} />
          <Input label="Ciudad" value={form.ciudad} onChange={(v) => setForm({ ...form, ciudad: v })} />
          <Input label="CUIT" value={form.cuit} onChange={(v) => setForm({ ...form, cuit: v })} />
          <Input label="Teléfono" value={form.telefono} onChange={(v) => setForm({ ...form, telefono: v })} />
          <Input label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Input label="Cantidad de pisos" type="number" value={form.cantidad_pisos} onChange={(v) => setForm({ ...form, cantidad_pisos: v })} />
        </div>
        <div className="mt-5 pt-4 border-t border-slate-100">
          <p className="text-sm font-semibold text-slate-700 mb-3">Reglas de liquidación</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Input label="Día 1º vencimiento" type="number" value={form.dia_vencimiento_1} onChange={(v) => setForm({ ...form, dia_vencimiento_1: v })} />
            <Input label="Día 2º vencimiento" type="number" value={form.dia_vencimiento_2} onChange={(v) => setForm({ ...form, dia_vencimiento_2: v })} />
            <Input label="Recargo 2º venc. (%)" type="number" step="0.01" value={form.recargo_2do_venc_pct} onChange={(v) => setForm({ ...form, recargo_2do_venc_pct: v })} />
            <Input label="Interés mora mensual (%)" type="number" step="0.01" value={form.interes_mora_mensual_pct} onChange={(v) => setForm({ ...form, interes_mora_mensual_pct: v })} />
            <Input label="Honorarios adm. ($/mes)" type="number" step="0.01" value={form.honorarios_mensuales} onChange={(v) => setForm({ ...form, honorarios_mensuales: v })} />
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="rounded" />
                Activo
              </label>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">El recargo se aplica a los gastos del período cuando se paga después del 1º vencimiento. El interés de mora se aplica cada mes sobre el saldo deudor arrastrado.</p>
        </div>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </Modal>

      {!loading && visibles.length > 0 && (
        <p className="text-xs text-slate-400 mt-4 flex items-center gap-2">
          <Badge color="teal">Tip</Badge> Los iconos de cada tarjeta llevan directo a Noticias, Unidades, Cuentas corrientes y Expensas de ese consorcio.
        </p>
      )}
    </div>
  );
}

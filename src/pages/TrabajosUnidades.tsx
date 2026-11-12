import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, ExternalLink, Hammer, Pencil, Plus, Receipt, Trash2, Upload } from 'lucide-react';
import { supabase, type Proveedor, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Ayuda } from '@/components/Ayuda';
import { PORTAL_URL, emailsConApp } from '@/lib/config';
import { cuentaPredeterminada, fmtDate, fmtMoney, hoyISO, round2 } from '@/lib/engine';
import { escHtml } from '@/lib/imprimir';

/*
  Trabajos en unidades: arreglos o mejoras hechas en una unidad puntual (no en partes comunes).
  Circuito: la administración carga el trabajo → avisa al propietario (mail + app) → el propietario lo confirma u observa
  desde el portal → se registran los pagos (parciales o totales) hasta saldarlo → se cierra.
*/

export type Trabajo = {
  id: string; consorcio_id: string; unidad_id: string; proveedor_id: string | null; numero: number; titulo: string; descripcion: string | null;
  a_cargo: 'propietario' | 'consorcio' | 'compartido'; monto: number; fecha_aviso: string; fecha_realizado: string | null;
  estado: 'avisado' | 'realizado' | 'confirmado' | 'observado' | 'cerrado'; avisado_at: string | null; confirmado_at: string | null; confirmado_por: string | null;
  observacion_propietario: string | null; archivo_path: string | null; notas: string | null; created_at: string;
  unidades?: Unidad; proveedores?: Proveedor; trabajos_pagos?: Pago[];
};
type Pago = { id: string; trabajo_id: string; fecha: string; monto: number; metodo: string; comprobante: string | null; notas: string | null };

const ESTADOS: Record<Trabajo['estado'], { label: string; color: 'amber' | 'blue' | 'green' | 'red' | 'slate' }> = {
  avisado: { label: 'Avisado', color: 'amber' }, realizado: { label: 'Realizado', color: 'blue' }, confirmado: { label: 'Confirmado', color: 'green' },
  observado: { label: 'Observado', color: 'red' }, cerrado: { label: 'Cerrado', color: 'slate' },
};
const A_CARGO: Record<string, string> = { propietario: 'Propietario', consorcio: 'Consorcio', compartido: 'Compartido' };
const vacio = { unidad_id: '', proveedor_id: '', titulo: '', descripcion: '', a_cargo: 'propietario', monto: '', fecha_aviso: hoyISO(), fecha_realizado: '', notas: '' };

export function TrabajosUnidades() {
  const { consorcio } = useApp();
  const [tab, setTab] = useState('abiertos');
  const [items, setItems] = useState<Trabajo[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Trabajo | null>(null);
  const [form, setForm] = useState({ ...vacio });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [pagoDe, setPagoDe] = useState<Trabajo | null>(null);
  const [pagoForm, setPagoForm] = useState({ fecha: hoyISO(), monto: '', metodo: 'transferencia', comprobante: '', notas: '', aCaja: true });
  const [borrar, setBorrar] = useState<Trabajo | null>(null);
  const [detalle, setDetalle] = useState<Trabajo | null>(null);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [t, u, p] = await Promise.all([
      supabase.from('trabajos_unidad').select('*, unidades(*), proveedores(*), trabajos_pagos(*)').eq('consorcio_id', consorcio.id).order('numero', { ascending: false }),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true).order('uf'),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
    ]);
    setItems((t.data as Trabajo[]) || []); setUnidades((u.data as Unidad[]) || []); setProveedores((p.data as Proveedor[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg('');
    try { const r = await fn(); if (r) setMsg(r); } catch (e) { setMsg(`Error: ${(e as Error).message}`); }
    setBusy(false); load();
  };

  const pagado = (t: Trabajo) => round2((t.trabajos_pagos || []).reduce((a, p) => a + Number(p.monto), 0));
  const saldo = (t: Trabajo) => round2(Number(t.monto) - pagado(t));
  const estadoPago = (t: Trabajo) => (Number(t.monto) <= 0 ? '—' : saldo(t) <= 0.01 ? 'Pagado' : pagado(t) > 0 ? 'Parcial' : 'Pendiente');
  const uLabel = (u?: Unidad | null) => (u ? `UF ${u.uf} · ${u.depto}${u.propietario ? ` · ${u.propietario}` : ''}` : '—');

  const guardar = () => run(async () => {
    if (!consorcio || !form.unidad_id || !form.titulo.trim()) throw new Error('Elegí la unidad y poné un título.');
    let archivo_path: string | undefined;
    if (archivo) {
      archivo_path = `trabajos/${consorcio.id}/${Date.now()}_${archivo.name.replace(/[^\w.\-]/g, '_')}`;
      const { error } = await supabase.storage.from('archivos').upload(archivo_path, archivo);
      if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
    }
    const payload = {
      consorcio_id: consorcio.id, unidad_id: form.unidad_id, proveedor_id: form.proveedor_id || null, titulo: form.titulo.trim(), descripcion: form.descripcion || null,
      a_cargo: form.a_cargo, monto: parseFloat(form.monto) || 0, fecha_aviso: form.fecha_aviso, fecha_realizado: form.fecha_realizado || null, notas: form.notas || null,
      ...(archivo_path ? { archivo_path } : {}), ...(form.fecha_realizado && (!editing || editing.estado === 'avisado') ? { estado: 'realizado' } : {}),
    };
    const { error } = editing ? await supabase.from('trabajos_unidad').update(payload).eq('id', editing.id) : await supabase.from('trabajos_unidad').insert(payload);
    if (error) throw new Error(error.message);
    setModal(false); setArchivo(null);
    return editing ? 'Trabajo actualizado.' : 'Trabajo cargado. Ahora podés avisarle al propietario con la campanita.';
  });

  /** Aviso al propietario: mail (y push si tiene la app) por la cola de envíos. */
  const avisar = (t: Trabajo) => run(async () => {
    const u = t.unidades || unidades.find((x) => x.id === t.unidad_id);
    if (!u?.propietario_email) throw new Error('La unidad no tiene mail de propietario cargado (Unidades).');
    const email = u.propietario_email.trim().toLowerCase();
    const conApp = await emailsConApp(supabase);
    const estadoTxt = t.estado === 'avisado' ? 'programado' : 'realizado';
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#334155">
      <h2 style="color:#0d9488;margin:0 0 6px">${escHtml(t.titulo)}</h2>
      <p style="margin:0 0 12px;color:#64748b">${escHtml(consorcio?.nombre)} · UF ${u.uf} ${escHtml(u.depto)}</p>
      <p>Le informamos que se encuentra <b>${estadoTxt}</b> el siguiente trabajo en su unidad:</p>
      ${t.descripcion ? `<p style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:8px">${escHtml(t.descripcion)}</p>` : ''}
      <table style="font-size:14px;border-collapse:collapse">
        ${t.fecha_realizado ? `<tr><td style="padding:3px 10px 3px 0;color:#64748b">Fecha</td><td>${fmtDate(t.fecha_realizado)}</td></tr>` : ''}
        ${t.proveedores?.nombre ? `<tr><td style="padding:3px 10px 3px 0;color:#64748b">Realizado por</td><td>${escHtml(t.proveedores.nombre)}</td></tr>` : ''}
        <tr><td style="padding:3px 10px 3px 0;color:#64748b">A cargo de</td><td>${A_CARGO[t.a_cargo]}</td></tr>
        ${Number(t.monto) > 0 ? `<tr><td style="padding:3px 10px 3px 0;color:#64748b">Importe a su cargo</td><td><b>${fmtMoney(Number(t.monto))}</b>${saldo(t) < Number(t.monto) ? ` (pagado ${fmtMoney(pagado(t))}, saldo ${fmtMoney(saldo(t))})` : ''}</td></tr>` : ''}
      </table>
      <p style="margin-top:16px">Por favor, <b>confirmá el trabajo</b> desde el portal, o dejanos tu observación:</p>
      <a href="${PORTAL_URL}" style="display:inline-block;background:#14b8a6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Entrar al portal</a>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px">${escHtml(consorcio?.nombre)} · Administración</p></div>`;
    const filas: Record<string, unknown>[] = [{
      consorcio_id: t.consorcio_id, unidad_id: t.unidad_id, trabajo_id: t.id, email, nombre: u.propietario, canal: 'mail',
      asunto: `Trabajo en su unidad: ${t.titulo} - ${consorcio?.nombre}`, html,
    }];
    if (conApp.has(email)) filas.push({
      consorcio_id: t.consorcio_id, unidad_id: t.unidad_id, trabajo_id: t.id, email, nombre: u.propietario, canal: 'push', asunto: t.titulo, html: null,
      push_titulo: `Trabajo en su unidad · ${consorcio?.nombre}`, push_cuerpo: `${t.titulo}: ${estadoTxt}. Entrá para confirmarlo.`, push_url: PORTAL_URL,
    });
    const { error } = await supabase.from('cola_envios').insert(filas);
    if (error) throw new Error(error.message);
    await supabase.from('trabajos_unidad').update({ avisado_at: new Date().toISOString() }).eq('id', t.id);
    return `Aviso encolado a ${email}${conApp.has(email) ? ' (mail + app)' : ' (mail)'}. Sale con el próximo procesamiento de la cola (Envíos de mail → Procesar ahora).`;
  });

  const cambiarEstado = (t: Trabajo, estado: Trabajo['estado']) => run(async () => {
    const payload: Record<string, unknown> = { estado };
    if (estado === 'realizado' && !t.fecha_realizado) payload.fecha_realizado = hoyISO();
    if (estado === 'confirmado') { payload.confirmado_at = new Date().toISOString(); payload.confirmado_por = 'administración'; }
    const { error } = await supabase.from('trabajos_unidad').update(payload).eq('id', t.id);
    if (error) throw new Error(error.message);
  });

  const registrarPago = () => run(async () => {
    if (!pagoDe) return;
    const monto = parseFloat(pagoForm.monto);
    if (!monto || monto <= 0) throw new Error('Ingresá el importe.');
    const { data: pago, error } = await supabase.from('trabajos_pagos').insert({ trabajo_id: pagoDe.id, fecha: pagoForm.fecha, monto, metodo: pagoForm.metodo, comprobante: pagoForm.comprobante || null, notas: pagoForm.notas || null }).select('id').single();
    if (error) throw new Error(error.message);
    let avisoCaja = '';
    if (pagoForm.aCaja) {
      // Ingreso en Contabilidad, vinculado al pago para poder borrarlo junto con él
      const u = pagoDe.unidades;
      const { error: eMov } = await supabase.from('movimientos').insert({
        consorcio_id: pagoDe.consorcio_id, cuenta_id: await cuentaPredeterminada(pagoDe.consorcio_id), fecha: pagoForm.fecha, tipo: 'ingreso',
        concepto: `Cobro trabajo #${pagoDe.numero} UF ${u?.uf ?? ''} ${u?.depto ?? ''} - ${pagoDe.titulo}`.replace(/\s+/g, ' ').trim(), monto, origen: 'manual', origen_id: pago.id,
        comprobante: pagoForm.comprobante || null,
      });
      if (eMov) avisoCaja = ` (Ojo: no se pudo anotar en Contabilidad: ${eMov.message})`;
    }
    const nuevoSaldo = round2(saldo(pagoDe) - monto);
    setPagoDe(null);
    return (nuevoSaldo <= 0.01 ? 'Pago registrado: el trabajo quedó saldado.' : `Pago registrado. Saldo pendiente: ${fmtMoney(nuevoSaldo)}.`) + avisoCaja;
  });

  /** Borra pagos y también su ingreso en Contabilidad (si lo tenían). */
  const borrarPagos = async (ids: string[]) => {
    if (!ids.length) return;
    await supabase.from('movimientos').delete().eq('origen', 'manual').in('origen_id', ids);
    const { error } = await supabase.from('trabajos_pagos').delete().in('id', ids);
    if (error) throw new Error(error.message);
  };

  if (!consorcio) return null;
  const lista = items.filter((t) => (tab === 'abiertos' ? t.estado !== 'cerrado' : tab === 'deuda' ? saldo(t) > 0.01 && Number(t.monto) > 0 : t.estado === 'cerrado'));
  const url = (p: string) => supabase.storage.from('archivos').getPublicUrl(p).data.publicUrl;

  return (
    <div>
      <PageHeader title={`Trabajos en unidades · ${consorcio.nombre}`} subtitle="Arreglos y mejoras en unidades: aviso, confirmación del propietario y cobro"
        action={<Button onClick={() => { setEditing(null); setForm({ ...vacio }); setArchivo(null); setModal(true); }}><Plus size={16} /> Nuevo trabajo</Button>} />
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 mb-4 ${msg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div>}
      <Ayuda id="trabajos" titulo="Cómo funciona">
        <ol>
          <li><b>Nuevo trabajo</b>: unidad, qué se hace, quién lo paga y cuánto; opcionalmente el proveedor y un presupuesto/foto.</li>
          <li><b>Campanita</b>: le manda al propietario un mail (y aviso en la app si la tiene) con el detalle y un botón para confirmar.</li>
          <li>El propietario, desde el portal, marca <b>Confirmo</b> o deja una <b>observación</b>; acá cambia el estado solo y te llega una notificación.</li>
          <li><b>Registrar pago</b>: cada pago parcial o total. Cuando el saldo llega a cero figura "Pagado"; entonces podés <b>cerrar</b> el trabajo.</li>
        </ol>
      </Ayuda>
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'abiertos', label: 'En curso', badge: items.filter((t) => t.estado !== 'cerrado').length },
        { key: 'deuda', label: 'Con saldo a cobrar', badge: items.filter((t) => saldo(t) > 0.01 && Number(t.monto) > 0).length || undefined },
        { key: 'cerrados', label: 'Cerrados' },
      ]} />
      {loading ? <Spinner /> : lista.length === 0 ? <Card><EmptyState icon={<Hammer size={28} />} title="Sin trabajos" subtitle="Cargá el primero con 'Nuevo trabajo'." /></Card> : (
        <Card>
          <Table headers={['N°', 'Unidad', 'Trabajo', 'A cargo', 'Importe', 'Pagado', 'Saldo', 'Estado', 'Propietario', '']}>
            {lista.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <Td className="text-slate-400">{t.numero}</Td>
                <Td className="font-medium">UF {t.unidades?.uf} · {t.unidades?.depto}<div className="text-xs text-slate-400">{t.unidades?.propietario}</div></Td>
                <Td><button onClick={() => setDetalle(t)} className="text-left font-medium text-slate-800 hover:text-teal-600">{t.titulo}</button><div className="text-xs text-slate-400">{t.proveedores?.nombre || ''}{t.fecha_realizado ? ` · ${fmtDate(t.fecha_realizado)}` : ` · aviso ${fmtDate(t.fecha_aviso)}`}</div></Td>
                <Td className="text-slate-500">{A_CARGO[t.a_cargo]}</Td>
                <Td className="font-semibold">{Number(t.monto) ? fmtMoney(Number(t.monto)) : '—'}</Td>
                <Td className="text-emerald-600">{pagado(t) ? fmtMoney(pagado(t)) : '—'}</Td>
                <Td className={saldo(t) > 0.01 && Number(t.monto) > 0 ? 'text-red-500 font-semibold' : 'text-slate-400'}>{Number(t.monto) ? fmtMoney(saldo(t)) : '—'}<div className="text-[10px] text-slate-400 font-normal">{estadoPago(t)}</div></Td>
                <Td><Badge color={ESTADOS[t.estado].color}>{ESTADOS[t.estado].label}</Badge></Td>
                <Td className="text-xs text-slate-500">
                  {t.confirmado_at ? <span className="text-emerald-600">✓ {fmtDate(t.confirmado_at.slice(0, 10))}</span> : t.avisado_at ? `avisado ${fmtDate(t.avisado_at.slice(0, 10))}` : 'sin avisar'}
                  {t.observacion_propietario && <div className="text-red-500 max-w-[180px] truncate" title={t.observacion_propietario}>“{t.observacion_propietario}”</div>}
                </Td>
                <Td><div className="flex gap-0.5 items-center">
                  <button title="Avisar al propietario" onClick={() => avisar(t)} disabled={busy} className="p-1.5 rounded text-amber-600 hover:bg-amber-50"><Bell size={14} /></button>
                  {Number(t.monto) > 0 && saldo(t) > 0.01 && <button title="Registrar pago" onClick={() => { setPagoForm({ fecha: hoyISO(), monto: String(saldo(t)), metodo: 'transferencia', comprobante: '', notas: '', aCaja: true }); setPagoDe(t); }} className="p-1.5 rounded text-emerald-600 hover:bg-emerald-50"><Receipt size={14} /></button>}
                  {t.estado === 'avisado' && <button title="Marcar realizado" onClick={() => cambiarEstado(t, 'realizado')} className="p-1.5 rounded text-blue-600 hover:bg-blue-50"><CheckCircle2 size={14} /></button>}
                  {(t.estado === 'realizado' || t.estado === 'observado') && <Button size="sm" variant="secondary" onClick={() => cambiarEstado(t, 'confirmado')}>Confirmar</Button>}
                  {t.estado !== 'cerrado' && (saldo(t) <= 0.01 || Number(t.monto) === 0) && t.estado === 'confirmado' && <Button size="sm" onClick={() => cambiarEstado(t, 'cerrado')}>Cerrar</Button>}
                  <button title="Editar" onClick={() => { setEditing(t); setForm({ unidad_id: t.unidad_id, proveedor_id: t.proveedor_id || '', titulo: t.titulo, descripcion: t.descripcion || '', a_cargo: t.a_cargo, monto: String(t.monto), fecha_aviso: t.fecha_aviso, fecha_realizado: t.fecha_realizado || '', notas: t.notas || '' }); setArchivo(null); setModal(true); }} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                  <button onClick={() => setBorrar(t)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                </div></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Editar trabajo #${editing.numero}` : 'Nuevo trabajo en unidad'} size="lg">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Unidad" value={form.unidad_id} onChange={(v) => setForm({ ...form, unidad_id: v })} placeholder="— Elegir —" options={unidades.map((u) => ({ value: u.id, label: uLabel(u) }))} required />
          <Select label="Proveedor / quien lo hace" value={form.proveedor_id} onChange={(v) => setForm({ ...form, proveedor_id: v })} placeholder="— Sin proveedor —" options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} />
          <div className="col-span-2"><Input label="Trabajo" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} placeholder="Cambio de flexible y canilla en cocina" required /></div>
          <div className="col-span-2"><Textarea label="Detalle (lo ve el propietario)" value={form.descripcion} onChange={(v) => setForm({ ...form, descripcion: v })} rows={3} /></div>
          <Select label="A cargo de" value={form.a_cargo} onChange={(v) => setForm({ ...form, a_cargo: v })} options={Object.entries(A_CARGO).map(([value, label]) => ({ value, label }))} />
          <Input label="Importe a cargo del propietario ($)" type="number" step="0.01" value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} />
          <Input label="Fecha de aviso" type="date" value={form.fecha_aviso} onChange={(v) => setForm({ ...form, fecha_aviso: v })} />
          <Input label="Fecha de realización (si ya se hizo)" type="date" value={form.fecha_realizado} onChange={(v) => setForm({ ...form, fecha_realizado: v })} />
          <div className="col-span-2"><Input label="Notas internas (no las ve el propietario)" value={form.notas} onChange={(v) => setForm({ ...form, notas: v })} /></div>
          <label className="col-span-2 text-sm text-slate-600"><span className="text-xs font-medium text-slate-500 block mb-1">Presupuesto / foto / factura (PDF o imagen)</span><span className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50 text-xs"><Upload size={13} /> {archivo ? archivo.name : editing?.archivo_path ? 'Reemplazar archivo' : 'Elegir archivo'}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] || null)} /></span></label>
        </div>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button><Button onClick={guardar} disabled={busy}>Guardar</Button></div>
      </Modal>

      <Modal open={!!pagoDe} onClose={() => setPagoDe(null)} title={`Registrar pago · ${pagoDe?.titulo || ''}`}>
        {pagoDe && <p className="text-sm text-slate-500 mb-4">{uLabel(pagoDe.unidades)} · Importe {fmtMoney(Number(pagoDe.monto))} · Pagado {fmtMoney(pagado(pagoDe))} · <b className="text-red-500">Saldo {fmtMoney(saldo(pagoDe))}</b></p>}
        <div className="grid grid-cols-2 gap-4">
          <Input label="Fecha" type="date" value={pagoForm.fecha} onChange={(v) => setPagoForm({ ...pagoForm, fecha: v })} />
          <Input label="Importe" type="number" step="0.01" value={pagoForm.monto} onChange={(v) => setPagoForm({ ...pagoForm, monto: v })} required />
          <Select label="Medio" value={pagoForm.metodo} onChange={(v) => setPagoForm({ ...pagoForm, metodo: v })} options={['transferencia', 'efectivo', 'cheque', 'mercadopago', 'otro'].map((m) => ({ value: m, label: m }))} />
          <Input label="Comprobante" value={pagoForm.comprobante} onChange={(v) => setPagoForm({ ...pagoForm, comprobante: v })} />
          <div className="col-span-2"><Input label="Notas" value={pagoForm.notas} onChange={(v) => setPagoForm({ ...pagoForm, notas: v })} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 mt-3"><input type="checkbox" checked={pagoForm.aCaja} onChange={(e) => setPagoForm({ ...pagoForm, aCaja: e.target.checked })} /> Ingresó a la caja del consorcio (lo anota en Contabilidad)</label>
        <p className="text-xs text-slate-400 mt-1">Destildalo si el propietario le pagó directo al proveedor. Si el importe es menor al saldo queda como pago parcial.</p>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setPagoDe(null)}>Cancelar</Button><Button onClick={registrarPago} disabled={busy}>Registrar</Button></div>
      </Modal>

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={detalle ? `#${detalle.numero} · ${detalle.titulo}` : ''}>
        {detalle && <div className="text-sm space-y-2">
          <p className="text-slate-500">{uLabel(detalle.unidades)}</p>
          {detalle.descripcion && <p className="whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{detalle.descripcion}</p>}
          <div className="grid grid-cols-2 gap-2 text-slate-600">
            <div>A cargo de: <b>{A_CARGO[detalle.a_cargo]}</b></div><div>Importe: <b>{fmtMoney(Number(detalle.monto))}</b></div>
            <div>Aviso: {fmtDate(detalle.fecha_aviso)}</div><div>Realizado: {detalle.fecha_realizado ? fmtDate(detalle.fecha_realizado) : '—'}</div>
            <div>Estado: <Badge color={ESTADOS[detalle.estado].color}>{ESTADOS[detalle.estado].label}</Badge></div>
            <div>{detalle.confirmado_at ? `Confirmado el ${fmtDate(detalle.confirmado_at.slice(0, 10))} por ${detalle.confirmado_por || '—'}` : detalle.avisado_at ? `Avisado el ${fmtDate(detalle.avisado_at.slice(0, 10))}` : 'Sin avisar'}</div>
          </div>
          {detalle.observacion_propietario && <p className="text-red-600 bg-red-50 rounded-lg p-3">Observación del propietario: {detalle.observacion_propietario}</p>}
          {detalle.archivo_path && <a href={url(detalle.archivo_path)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-teal-600 font-medium"><ExternalLink size={13} /> Ver archivo adjunto</a>}
          <div className="pt-2 border-t border-slate-100">
            <p className="font-semibold text-slate-700 mb-1">Pagos</p>
            {(detalle.trabajos_pagos || []).length === 0 ? <p className="text-slate-400">Sin pagos registrados.</p> : (detalle.trabajos_pagos || []).map((p) => (
              <div key={p.id} className="flex justify-between py-1 border-b border-slate-100"><span className="text-slate-500">{fmtDate(p.fecha)} · {p.metodo}{p.comprobante ? ` · ${p.comprobante}` : ''}</span><span className="flex items-center gap-2"><b>{fmtMoney(Number(p.monto))}</b><button onClick={() => run(async () => { await borrarPagos([p.id]); setDetalle(null); return 'Pago eliminado.'; })} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button></span></div>
            ))}
            <div className="flex justify-between pt-2 font-semibold"><span>Saldo</span><span className={saldo(detalle) > 0.01 ? 'text-red-500' : 'text-emerald-600'}>{fmtMoney(saldo(detalle))}</span></div>
          </div>
          {detalle.notas && <p className="text-xs text-slate-400">Notas internas: {detalle.notas}</p>}
        </div>}
      </Modal>

      <ConfirmDialog open={!!borrar} title="Eliminar trabajo" message={`¿Eliminar "${borrar?.titulo}" y sus pagos registrados?`} onCancel={() => setBorrar(null)}
        onConfirm={() => { const t = borrar; setBorrar(null); if (t) run(async () => { await borrarPagos((t.trabajos_pagos || []).map((p) => p.id)); const { error } = await supabase.from('trabajos_unidad').delete().eq('id', t.id); if (error) throw new Error(error.message); }); }} />
    </div>
  );
}

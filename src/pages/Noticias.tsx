import { useEffect, useState } from 'react';
import { MoreVertical, Megaphone, Paperclip, Pencil, Pin, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { supabase, type Comunicado, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fmtDate, hoyISO, notificar } from '@/lib/engine';
import { PORTAL_URL, emailsConApp } from '@/lib/config';

const TIPOS = ['general', 'urgente', 'mantenimiento', 'asamblea', 'administrativo'];
const tipoColor: Record<string, 'slate' | 'red' | 'amber' | 'purple' | 'blue'> = {
  general: 'slate', urgente: 'red', mantenimiento: 'amber', asamblea: 'purple', administrativo: 'blue',
};
const estadoColor = { borrador: 'slate', programado: 'blue', enviado: 'green' } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtFechaHora = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Form = {
  consorcio_id: string; tipo: string; titulo: string; contenido: string; etiquetas: string;
  fecha_publicacion: string; fijado: boolean; destinatarios: string; programado: string; canal: string;
};
const vacio = (consorcioId = ''): Form => ({
  consorcio_id: consorcioId, tipo: 'general', titulo: '', contenido: '', etiquetas: '',
  fecha_publicacion: hoyISO(), fijado: false, destinatarios: 'todos', programado: '', canal: 'mail',
});
const canalLabel: Record<string, string> = { mail: 'Mail', push: 'App', ambos: 'Mail + App' };

type Resumen = { enviados: number; cola: number; errores: number };

export function Noticias() {
  const { consorcio, consorcios } = useApp();
  const [tab, setTab] = useState('comunicados');
  const [items, setItems] = useState<Comunicado[]>([]);
  const [envios, setEnvios] = useState<Record<string, Resumen>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // filtros (como Octavo)
  const [fTexto, setFTexto] = useState('');
  const [fEstado, setFEstado] = useState('');
  const [fDesde, setFDesde] = useState('');

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Comunicado | null>(null);
  const [form, setForm] = useState<Form>(vacio());
  const [archivo, setArchivo] = useState<File | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Comunicado | null>(null);
  const [enviarTarget, setEnviarTarget] = useState<Comunicado | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: cola }] = await Promise.all([
      supabase.from('comunicados').select('*, consorcios(*)').eq('activo', true)
        .order('fijado', { ascending: false }).order('fecha_publicacion', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('cola_envios').select('comunicado_id, estado').not('comunicado_id', 'is', null),
    ]);
    setItems((data as Comunicado[]) || []);
    const r: Record<string, Resumen> = {};
    for (const c of (cola as { comunicado_id: string; estado: string }[]) || []) {
      const x = (r[c.comunicado_id] ||= { enviados: 0, cola: 0, errores: 0 });
      if (c.estado === 'enviado') x.enviados++; else if (c.estado === 'error') x.errores++; else x.cola++;
    }
    setEnvios(r);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const deLaSeccion = items.filter((c) => c.seccion === tab)
    .filter((c) => !consorcio || !c.consorcio_id || c.consorcio_id === consorcio.id);

  const visiblesComunicados = deLaSeccion
    .filter((c) => !fTexto || `${c.titulo} ${c.contenido} ${c.etiquetas || ''}`.toLowerCase().includes(fTexto.toLowerCase()))
    .filter((c) => !fEstado || c.estado === fEstado)
    .filter((c) => !fDesde || c.fecha_publicacion >= fDesde)
    .sort((a, b) => (b.numero || 0) - (a.numero || 0));

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const t = await fn(); if (t) setMsg({ tipo: 'ok', texto: t }); }
    catch (e) { setMsg({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); load(); }
  };

  // ---------- Alta / edición ----------
  const abrirNuevo = () => { setEditing(null); setForm(vacio(consorcio?.id || '')); setArchivo(null); setModal(true); };
  const abrirEditar = (c: Comunicado) => {
    setEditing(c); setArchivo(null); setMenu(null);
    setForm({
      consorcio_id: c.consorcio_id || '', tipo: c.tipo, titulo: c.titulo, contenido: c.contenido, etiquetas: c.etiquetas || '',
      fecha_publicacion: c.fecha_publicacion, fijado: c.fijado, destinatarios: c.destinatarios || 'todos',
      programado: c.programado_at ? fmtFechaHora(c.programado_at).replace(' ', 'T') : '', canal: c.canal || 'mail',
    });
    setModal(true);
  };

  /** Guarda el comunicado. Devuelve el registro guardado. */
  const guardar = async (): Promise<Comunicado> => {
    if (!form.titulo.trim() || !form.contenido.trim()) throw new Error('Completá título y contenido.');
    const payload = {
      consorcio_id: form.consorcio_id || null, seccion: editing?.seccion || tab, tipo: form.tipo,
      titulo: form.titulo.trim(), contenido: form.contenido.trim(), etiquetas: form.etiquetas.trim() || null,
      fecha_publicacion: form.fecha_publicacion, fijado: form.fijado, destinatarios: form.destinatarios, canal: form.canal,
    };
    let guardado: Comunicado;
    if (editing) {
      const { data, error } = await supabase.from('comunicados').update(payload).eq('id', editing.id).select().single();
      if (error) throw new Error(error.message);
      guardado = data as Comunicado;
    } else {
      // número correlativo por consorcio, como en Octavo
      const mismos = items.filter((i) => i.consorcio_id === (form.consorcio_id || null) && i.seccion === payload.seccion);
      const numero = mismos.reduce((m, i) => Math.max(m, i.numero || 0), 0) + 1;
      const { data, error } = await supabase.from('comunicados').insert({ ...payload, numero, estado: 'borrador' }).select().single();
      if (error) throw new Error(error.message);
      guardado = data as Comunicado;
    }
    if (archivo) {
      if (archivo.size > 25 * 1024 * 1024) throw new Error('El adjunto supera 25 MB.');
      const path = `comunicados/${guardado.id}_${archivo.name.replace(/[^\w.\-]/g, '_')}`;
      const { error } = await supabase.storage.from('archivos').upload(path, archivo, { upsert: true });
      if (error) throw new Error(`No se pudo subir el adjunto: ${error.message}`);
      await supabase.from('comunicados').update({ adjunto_path: path }).eq('id', guardado.id);
      guardado = { ...guardado, adjunto_path: path };
    }
    return guardado;
  };

  const guardarBorrador = () => run(async () => {
    await guardar();
    setModal(false);
    return 'Comunicado guardado como borrador.';
  });

  const guardarYEnviar = () => run(async () => {
    const c = await guardar();
    setModal(false);
    return await encolar(c, form.programado ? new Date(form.programado).toISOString() : null);
  });

  // ---------- Envío por mail (usa la misma cola que las expensas) ----------
  const encolar = async (c: Comunicado, programadoAt: string | null): Promise<string> => {
    if (c.seccion !== 'comunicados') throw new Error('Sólo los comunicados se envían por mail.');
    if (programadoAt && programadoAt <= new Date().toISOString()) programadoAt = null;

    let q = supabase.from('unidades').select('*, consorcios(nombre)').eq('activo', true);
    if (c.consorcio_id) q = q.eq('consorcio_id', c.consorcio_id);
    const { data: us, error: uErr } = await q;
    if (uErr) throw new Error(uErr.message);

    const { data: adm } = await supabase.from('administracion').select('nombre').limit(1).maybeSingle();
    const admin = adm?.nombre || 'La Administración';
    const canal = c.canal || 'mail';
    const conApp = canal !== 'mail' ? await emailsConApp(supabase) : new Set<string>();
    const resumenPush = c.contenido.replace(/\s+/g, ' ').slice(0, 140) + (c.contenido.length > 140 ? '…' : '');

    const filas: Record<string, unknown>[] = [];
    let sinMail = 0, push = 0;
    for (const u of (us as (Unidad & { consorcios: { nombre: string } | null })[]) || []) {
      const dest: { email: string; nombre: string }[] = [];
      const prop = u.propietario_email?.trim().toLowerCase();
      const inq = u.alquilada ? u.inquilino_email?.trim().toLowerCase() : undefined;
      if (prop && c.destinatarios !== 'inquilinos') dest.push({ email: prop, nombre: u.propietario || 'propietario/a' });
      if (inq && c.destinatarios !== 'propietarios' && inq !== prop) dest.push({ email: inq, nombre: u.inquilino || 'inquilino/a' });
      if (dest.length === 0) { sinMail++; continue; }
      const consorcioNombre = u.consorcios?.nombre || '';
      for (const d of dest) {
        if (canal !== 'mail' && conApp.has(d.email)) {
          push++;
          filas.push({
            comunicado_id: c.id, consorcio_id: u.consorcio_id, unidad_id: u.id, email: d.email, nombre: d.nombre, canal: 'push',
            asunto: c.titulo, html: null, push_titulo: `${c.titulo} · ${consorcioNombre}`, push_cuerpo: resumenPush, push_url: PORTAL_URL,
            enviar_desde: programadoAt,
          });
        }
        // Por mail: siempre si el canal es "mail" o "ambos"; si es sólo "app", se manda por mail a quien NO tiene la app
        if (canal === 'push' && conApp.has(d.email)) continue;
        filas.push({
          comunicado_id: c.id, consorcio_id: u.consorcio_id, unidad_id: u.id, email: d.email, nombre: d.nombre, canal: 'mail',
          asunto: `${c.titulo} - ${consorcioNombre}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#334155">
  <div style="background:#14b8a6;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
    <div style="font-size:12px;opacity:.9;text-transform:uppercase">Comunicado · ${esc(consorcioNombre)}</div>
    <div style="font-size:18px;font-weight:700;margin-top:2px">${esc(c.titulo)}</div>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:0;padding:16px 20px;border-radius:0 0 8px 8px;font-size:14px;line-height:1.5">
    <p>Hola ${esc(d.nombre)},</p>
    <div>${esc(c.contenido).replace(/\n/g, '<br>')}</div>
    <p style="font-size:13px;color:#64748b;margin-top:20px">${esc(admin)}</p>
  </div></div>`,
          adjunto_path: c.adjunto_path, adjunto_nombre: c.adjunto_path ? c.adjunto_path.split('/').pop()!.replace(/^[0-9a-f-]{36}_/, '') : null,
          enviar_desde: programadoAt,
        });
      }
    }
    if (filas.length === 0) throw new Error('Ninguna unidad tiene mail cargado para esos destinatarios.');

    const { error } = await supabase.from('cola_envios').insert(filas);
    if (error) throw new Error(error.message);

    await supabase.from('comunicados').update(programadoAt
      ? { estado: 'programado', programado_at: programadoAt }
      : { estado: 'enviado', programado_at: null, ultimo_envio: new Date().toISOString() }).eq('id', c.id);
    await notificar('info', `Comunicado ${programadoAt ? 'programado' : 'enviado'}: ${c.titulo}`, `${filas.length} destinatarios`);

    const extra = `${push ? ` · ${push} por la app` : ''}${sinMail ? ` · ${sinMail} unidades sin mail` : ''}`;
    if (programadoAt) return `Programado para el ${fmtFechaHora(programadoAt)}: ${filas.length} destinatarios${extra}.`;

    const { data, error: fErr } = await supabase.functions.invoke('enviar-expensas', { body: {} });
    if (fErr) return `Encolados ${filas.length} destinatarios${extra}. La función de envío todavía no está configurada en Supabase: salen cuando esté lista.`;
    const d = data as { enviados: number; quedan: number; enviadosHoy: number; limite: number; mensaje?: string };
    return `Encolados ${filas.length}${extra}. Enviados ahora: ${d.enviados} · en cola: ${d.quedan} · hoy ${d.enviadosHoy}/${d.limite}.${d.mensaje ? ` ${d.mensaje}` : ''}`;
  };

  const toggleFijado = (c: Comunicado) => run(async () => { await supabase.from('comunicados').update({ fijado: !c.fijado }).eq('id', c.id); });

  const cancelarProgramado = (c: Comunicado) => run(async () => {
    await supabase.from('cola_envios').delete().eq('comunicado_id', c.id).eq('estado', 'pendiente');
    await supabase.from('comunicados').update({ estado: c.ultimo_envio ? 'enviado' : 'borrador', programado_at: null }).eq('id', c.id);
    setMenu(null);
    return 'Envío programado cancelado.';
  });

  const verAdjunto = (path: string) => {
    const { data } = supabase.storage.from('archivos').getPublicUrl(path);
    window.open(data.publicUrl, '_blank');
  };

  const esComunicados = tab === 'comunicados';

  return (
    <div>
      <PageHeader title="Noticias" subtitle={consorcio ? `Publicaciones generales y de ${consorcio.nombre}` : 'Publicaciones de todos los consorcios'}
        action={<Button onClick={abrirNuevo}><Plus size={16} /> Nuevo</Button>} />

      <Tabs active={tab} onChange={(k) => { setTab(k); setMsg(null); }} tabs={[
        { key: 'novedades', label: 'Novedades', badge: items.filter((i) => i.seccion === 'novedades').length },
        { key: 'comunicados', label: 'Comunicados', badge: items.filter((i) => i.seccion === 'comunicados').length },
        { key: 'muro', label: 'Muro', badge: items.filter((i) => i.seccion === 'muro').length },
      ]} />

      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 mb-4 ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.texto}</div>}

      {esComunicados ? (
        <Card>
          {/* Filtros */}
          <div className="flex flex-wrap items-end gap-3 p-4">
            <div className="flex-1 min-w-[220px] max-w-md">
              <label className="block text-xs font-medium text-slate-500 mb-1">Contenido</label>
              <div className="flex">
                <button onClick={() => setFTexto('')} className="px-2.5 border border-r-0 border-slate-200 rounded-l-md bg-slate-50 text-slate-400"><X size={13} /></button>
                <input value={fTexto} onChange={(e) => setFTexto(e.target.value)} placeholder="Busque por título, contenido o etiquetas..."
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-r-md focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
              </div>
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
              <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white">
                <option value="">Todos</option><option value="borrador">Borrador</option><option value="programado">Programado</option><option value="enviado">Enviado</option>
              </select>
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-slate-500 mb-1">Fecha desde</label>
              <input type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md" />
            </div>
            <div className="flex-1" />
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-teal-50 text-teal-600 text-sm font-medium hover:bg-teal-100"><RefreshCw size={13} /> Refrescar</button>
          </div>

          {loading ? <Spinner /> : visiblesComunicados.length === 0 ? (
            <EmptyState icon={<Megaphone size={28} />} title="No hay comunicados para el criterio buscado." />
          ) : (
            <Table headers={['Número', 'Fecha', 'Título', 'Estado', 'Programado', 'Último envío', 'Acciones']}>
              {visiblesComunicados.map((c) => {
                const r = envios[c.id];
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <Td className="text-slate-500">{c.numero ?? '—'}</Td>
                    <Td className="text-slate-500 whitespace-nowrap">{c.fecha_publicacion}</Td>
                    <Td className="max-w-md">
                      <span className="font-medium text-slate-700" title={c.titulo}>{c.titulo}</span>
                      {c.adjunto_path && <button onClick={() => verAdjunto(c.adjunto_path!)} title="Ver adjunto" className="ml-1.5 text-slate-400 hover:text-teal-600 align-middle"><Paperclip size={12} /></button>}
                      <span className="flex gap-1 mt-0.5 flex-wrap">
                        {c.tipo !== 'general' && <Badge color={tipoColor[c.tipo] || 'slate'}>{cap(c.tipo)}</Badge>}
                        {!consorcio && (c.consorcio_id ? <Badge color="blue">{c.consorcios?.nombre}</Badge> : <Badge color="teal">Todos</Badge>)}
                        {r && <span className="text-[11px] text-slate-400">{r.enviados} enviados{r.cola ? ` · ${r.cola} en cola` : ''}{r.errores ? ` · ${r.errores} con error` : ''}</span>}
                      </span>
                    </Td>
                    <Td><Badge color={estadoColor[c.estado] || 'slate'}>{cap(c.estado || 'borrador')}</Badge><span className="block text-[10px] text-slate-400 mt-0.5">{canalLabel[c.canal] || 'Mail'}</span></Td>
                    <Td className="text-slate-500 text-xs whitespace-nowrap">{c.estado === 'programado' ? fmtFechaHora(c.programado_at) : ''}</Td>
                    <Td className="text-slate-500 text-xs whitespace-nowrap">{fmtFechaHora(c.ultimo_envio)}</Td>
                    <Td>
                      <div className="relative flex justify-end">
                        <button onClick={() => setMenu(menu === c.id ? null : c.id)} className="p-1.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200"><MoreVertical size={14} /></button>
                        {menu === c.id && (
                          <div className="absolute right-0 top-8 z-20 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm">
                            <button onClick={() => { setMenu(null); setEnviarTarget(c); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2"><Send size={13} /> {c.ultimo_envio ? 'Reenviar' : 'Enviar'}</button>
                            {c.estado === 'programado' && <button onClick={() => cancelarProgramado(c)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2"><X size={13} /> Cancelar programado</button>}
                            <button onClick={() => abrirEditar(c)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2"><Pencil size={13} /> Editar</button>
                            <button onClick={() => { setMenu(null); setDeleteTarget(c); }} className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-500 flex items-center gap-2"><Trash2 size={13} /> Eliminar</button>
                          </div>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      ) : loading ? <Spinner /> : deLaSeccion.length === 0 ? (
        <Card><EmptyState icon={<Megaphone size={28} />} title={`Sin publicaciones en ${tab}`} /></Card>
      ) : (
        <div className="space-y-3">
          {deLaSeccion.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.fijado && <Pin size={13} className="text-teal-500" />}
                    <p className="font-semibold text-slate-800">{c.titulo}</p>
                    <Badge color={tipoColor[c.tipo] || 'slate'}>{cap(c.tipo)}</Badge>
                    {!c.consorcio_id ? <Badge color="teal">Todos</Badge> : <Badge color="blue">{c.consorcios?.nombre}</Badge>}
                  </div>
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{c.contenido}</p>
                  <p className="text-xs text-slate-400 mt-2">{fmtDate(c.fecha_publicacion)}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => toggleFijado(c)} className={`p-1.5 rounded ${c.fijado ? 'text-teal-500 bg-teal-50' : 'text-slate-300 hover:bg-slate-100'}`} title="Fijar"><Pin size={14} /></button>
                  <button onClick={() => abrirEditar(c)} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteTarget(c)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Alta / edición */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Editar publicación' : `Nueva publicación en ${tab}`} size="lg">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Select label="Consorcio" value={form.consorcio_id} onChange={(v) => setForm({ ...form, consorcio_id: v })} placeholder="Todos los consorcios"
            options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} />
          <Select label="Tipo" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })}
            options={TIPOS.map((t) => ({ value: t, label: cap(t) }))} />
        </div>
        <div className="space-y-4">
          <Input label="Título" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} required />
          <Textarea label="Contenido" value={form.contenido} onChange={(v) => setForm({ ...form, contenido: v })} rows={6} required />
          <div className="grid grid-cols-2 gap-4 items-end">
            <Input label="Etiquetas" value={form.etiquetas} onChange={(v) => setForm({ ...form, etiquetas: v })} placeholder="obras, convivencia…" />
            <Input label="Fecha" type="date" value={form.fecha_publicacion} onChange={(v) => setForm({ ...form, fecha_publicacion: v })} />
          </div>

          {(editing?.seccion || tab) === 'comunicados' ? (
            <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4">
              <Select label="Enviar a" value={form.destinatarios} onChange={(v) => setForm({ ...form, destinatarios: v })}
                options={[{ value: 'todos', label: 'Propietarios e inquilinos' }, { value: 'propietarios', label: 'Sólo propietarios' }, { value: 'inquilinos', label: 'Sólo inquilinos' }]} />
              <Select label="Canal" value={form.canal} onChange={(v) => setForm({ ...form, canal: v })}
                options={[{ value: 'mail', label: 'Mail' }, { value: 'ambos', label: 'Mail + notificación en la app' }, { value: 'push', label: 'App (mail sólo a quien no la tiene)' }]} />
              <div className="col-span-2"><Input label="Programar envío (opcional)" type="datetime-local" value={form.programado} onChange={(v) => setForm({ ...form, programado: v })} /></div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Adjunto (opcional)</label>
                <input type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)}
                  className="w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-teal-50 file:text-teal-600 file:font-medium file:text-sm" />
                {editing?.adjunto_path && !archivo && <p className="text-xs text-slate-400 mt-1">Ya tiene un adjunto; elegí otro archivo sólo si querés reemplazarlo.</p>}
              </div>
            </div>
          ) : (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.fijado} onChange={(e) => setForm({ ...form, fijado: e.target.checked })} className="rounded" /> Fijar arriba
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancelar</Button>
          {(editing?.seccion || tab) === 'comunicados' ? (
            <>
              <Button variant="secondary" onClick={guardarBorrador} disabled={busy}>Guardar borrador</Button>
              <Button onClick={guardarYEnviar} disabled={busy}><Send size={14} /> {form.programado ? 'Programar envío' : 'Guardar y enviar'}</Button>
            </>
          ) : (
            <Button onClick={guardarBorrador} disabled={busy}>Publicar</Button>
          )}
        </div>
      </Modal>

      <ConfirmDialog open={!!enviarTarget} title={enviarTarget?.ultimo_envio ? 'Reenviar comunicado' : 'Enviar comunicado'}
        message={`Se envía "${enviarTarget?.titulo}" por mail a ${enviarTarget?.consorcio_id ? 'las unidades de ' + (enviarTarget?.consorcios?.nombre || 'el consorcio') : 'todas las unidades de todos los consorcios'}. ¿Continuar?`}
        onCancel={() => setEnviarTarget(null)}
        onConfirm={() => { const c = enviarTarget; setEnviarTarget(null); if (c) run(() => encolar(c, null)); }} />

      <ConfirmDialog open={!!deleteTarget} title="Eliminar publicación" message={`¿Eliminar "${deleteTarget?.titulo}"? Si tiene envíos en cola, se cancelan.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { const c = deleteTarget; setDeleteTarget(null); if (c) run(async () => { await supabase.from('comunicados').delete().eq('id', c.id); }); }} />
    </div>
  );
}
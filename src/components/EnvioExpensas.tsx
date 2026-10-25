import { useEffect, useState } from 'react';
import { FileUp, Mail, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { supabase, type Cupon, type Liquidacion } from '@/lib/supabase';
import { Badge, Button, Card, Spinner, Table, Td } from '@/components/ui';
import { fmtDate, fmtMoney, notificar, periodoLabel } from '@/lib/engine';
import { PORTAL_URL, emailsConApp } from '@/lib/config';

/*
  Envío de expensas por mail:
  1. Se adjunta el PDF de la liquidación (uno para todo el consorcio).
  2. "Encolar envío" crea un registro por cada destinatario en cola_envios.
  3. La función enviar-expensas (Supabase + Resend) procesa la cola respetando el límite diario;
     corre sola cada hora y también se puede disparar con "Procesar ahora".
*/

type ItemCola = {
  id: string; unidad_id: string | null; email: string; nombre: string | null;
  estado: 'pendiente' | 'enviando' | 'enviado' | 'error'; error: string | null; enviado_at: string | null; intentos: number;
};

const estadoColor = { pendiente: 'amber', enviando: 'blue', enviado: 'green', error: 'red' } as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function armarHtml(p: {
  nombre: string; consorcio: string; periodo: string; uf: number; depto: string;
  saldo: number; intereses: number; total: number; total2: number; vto1: string; vto2: string; admin: string;
}) {
  const fila = (k: string, v: string, b = false) =>
    `<tr><td style="padding:6px 12px;color:#64748b">${k}</td><td style="padding:6px 12px;text-align:right;${b ? 'font-weight:700;color:#0f172a' : 'color:#334155'}">${v}</td></tr>`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#334155">
  <div style="background:#14b8a6;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
    <div style="font-size:18px;font-weight:700">Expensas ${esc(p.periodo)}</div>
    <div style="font-size:13px;opacity:.9">${esc(p.consorcio)} · UF ${p.uf} (${esc(p.depto)})</div>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:0;padding:16px 20px;border-radius:0 0 8px 8px">
    <p>Hola ${esc(p.nombre)},</p>
    <p>Te enviamos la liquidación de expensas de <b>${esc(p.periodo)}</b>. Adjuntamos el PDF con el detalle.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
      ${p.saldo !== 0 ? fila('Saldo anterior', fmtMoney(p.saldo)) : ''}
      ${p.intereses > 0 ? fila('Intereses', fmtMoney(p.intereses)) : ''}
      ${fila(`Total hasta el ${p.vto1}`, fmtMoney(p.total), true)}
      ${fila(`Total hasta el ${p.vto2}`, fmtMoney(p.total2))}
    </table>
    <p style="font-size:13px;color:#64748b">Ante cualquier consulta, respondé este mail.</p>
    <p style="font-size:13px">${esc(p.admin)}</p>
  </div></div>`;
}

export function EnvioExpensas({ liq, cupones, consorcioNombre, onChange }: {
  liq: Liquidacion; cupones: Cupon[]; consorcioNombre: string; onChange: () => void;
}) {
  const [cola, setCola] = useState<ItemCola[]>([]);
  const [admin, setAdmin] = useState('La Administración');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'warn'; texto: string } | null>(null);
  const [conPush, setConPush] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: adm }] = await Promise.all([
      supabase.from('cola_envios').select('id, unidad_id, email, nombre, estado, error, enviado_at, intentos').eq('liquidacion_id', liq.id).order('created_at'),
      supabase.from('administracion').select('nombre').limit(1).maybeSingle(),
    ]);
    setCola((data as ItemCola[]) || []);
    if (adm?.nombre) setAdmin(adm.nombre);
    setLoading(false);
  };
  useEffect(() => { load(); }, [liq.id]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const t = await fn(); if (t) setMsg({ tipo: 'ok', texto: t }); }
    catch (e) { setMsg({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); await load(); onChange(); }
  };

  // ---- PDF ----
  const subirPdf = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf';
    input.onchange = () => run(async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) throw new Error('El PDF supera 25 MB: es demasiado grande para mandarlo por mail.');
      const path = `liquidaciones/${liq.id}.pdf`;
      const { error } = await supabase.storage.from('archivos').upload(path, file, { upsert: true, contentType: 'application/pdf' });
      if (error) throw new Error(`No se pudo subir el PDF: ${error.message}`);
      const { error: e2 } = await supabase.from('liquidaciones').update({ pdf_path: path }).eq('id', liq.id);
      if (e2) throw new Error(e2.message);
      return `PDF adjuntado (${Math.round(file.size / 1024)} KB).`;
    });
    input.click();
  };

  const verPdf = () => {
    if (!liq.pdf_path) return;
    const { data } = supabase.storage.from('archivos').getPublicUrl(liq.pdf_path);
    window.open(`${data.publicUrl}?t=${Date.now()}`, '_blank');
  };

  // ---- Destinatarios ----
  const destinatarios = cupones.flatMap((c) => {
    const u = c.unidades;
    if (!u) return [];
    const out: { cupon: Cupon; email: string; nombre: string }[] = [];
    if (u.propietario_email) out.push({ cupon: c, email: u.propietario_email.trim().toLowerCase(), nombre: u.propietario || 'propietario/a' });
    if (u.alquilada && u.inquilino_email && u.inquilino_email.trim().toLowerCase() !== u.propietario_email?.trim().toLowerCase()) {
      out.push({ cupon: c, email: u.inquilino_email.trim().toLowerCase(), nombre: u.inquilino || 'inquilino/a' });
    }
    return out;
  });
  const sinMail = cupones.filter((c) => c.unidades && !c.unidades.propietario_email && !(c.unidades.alquilada && c.unidades.inquilino_email));

  // ---- Encolar ----
  const encolar = () => run(async () => {
    if (liq.estado === 'abierta') throw new Error('Primero cerrá el período: sólo se envían liquidaciones cerradas.');
    if (!liq.pdf_path) throw new Error('Adjuntá el PDF de la liquidación antes de enviar.');
    if (destinatarios.length === 0) throw new Error('Ninguna unidad tiene mail cargado. Cargalos en Unidades.');
    const periodo = periodoLabel(liq.periodo);
    const conApp = conPush ? await emailsConApp(supabase) : new Set<string>();
    const filasPush = destinatarios.filter((d) => conApp.has(d.email)).map(({ cupon, email, nombre }) => ({
      liquidacion_id: liq.id, consorcio_id: liq.consorcio_id, unidad_id: cupon.unidad_id, email, nombre, canal: 'push', html: null,
      asunto: `Expensas ${periodo} - ${consorcioNombre}`,
      push_titulo: `Expensas ${periodo} · ${consorcioNombre}`,
      push_cuerpo: `UF ${cupon.unidades?.uf}: ${fmtMoney(Number(cupon.total))} hasta el ${fmtDate(liq.fecha_vencimiento_1)}. Tocá para ver la liquidación.`,
      push_url: PORTAL_URL,
    }));
    const filas = destinatarios.map(({ cupon, email, nombre }) => ({
      liquidacion_id: liq.id, consorcio_id: liq.consorcio_id, unidad_id: cupon.unidad_id, email, nombre, canal: 'mail', adjunto_path: liq.pdf_path,
      asunto: `Expensas ${periodo} - ${consorcioNombre} - UF ${cupon.unidades?.uf}`,
      adjunto_nombre: `Expensas_${liq.periodo}_${consorcioNombre.replace(/[^\w]+/g, '_')}.pdf`,
      html: armarHtml({
        nombre, consorcio: consorcioNombre, periodo, uf: cupon.unidades?.uf || 0, depto: cupon.unidades?.depto || '',
        saldo: Number(cupon.saldo_anterior), intereses: Number(cupon.intereses),
        total: Number(cupon.total), total2: Number(cupon.total_2do_venc),
        vto1: fmtDate(liq.fecha_vencimiento_1), vto2: fmtDate(liq.fecha_vencimiento_2), admin,
      }),
    }));
    // ignoreDuplicates: a quien ya está en la cola (o ya lo recibió) no se le vuelve a mandar
    const { error } = await supabase.from('cola_envios').upsert([...filas, ...filasPush], { onConflict: 'liquidacion_id,unidad_id,email,canal', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    if (liq.estado === 'cerrada') {
      await supabase.from('liquidaciones').update({ estado: 'enviada', enviada_at: new Date().toISOString() }).eq('id', liq.id);
    }
    await notificar('info', `Envío de expensas ${liq.periodo} encolado`, `${consorcioNombre}: ${filas.length} destinatarios.`);
    const res = await procesarCola();
    return `Encolados ${filas.length} mails${filasPush.length ? ` y ${filasPush.length} avisos por la app` : ''}. ${res}`;
  });

  const procesarCola = async (): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('enviar-expensas', { body: {} });
    if (error) {
      return 'Quedaron en cola: la función de envío todavía no está instalada o configurada en Supabase (se envían cuando esté lista).';
    }
    const d = data as { enviados: number; errores: number; quedan: number; enviadosHoy: number; limite: number; mensaje?: string; error?: string };
    if (d.error) return `Quedaron en cola: ${d.error}`;
    return `Enviados ahora: ${d.enviados}${d.errores ? ` · con error: ${d.errores}` : ''} · en cola: ${d.quedan} · hoy: ${d.enviadosHoy}/${d.limite}.${d.mensaje ? ` ${d.mensaje}` : ''}`;
  };

  const reintentar = () => run(async () => {
    const { error } = await supabase.from('cola_envios').update({ estado: 'pendiente', error: null }).eq('liquidacion_id', liq.id).eq('estado', 'error');
    if (error) throw new Error(error.message);
    return await procesarCola();
  });

  const cuenta = (e: ItemCola['estado']) => cola.filter((c) => c.estado === e).length;
  const ufDe = (unidadId: string | null) => cupones.find((c) => c.unidad_id === unidadId)?.unidades;

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`text-sm rounded-lg px-4 py-2.5 ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : msg.tipo === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>{msg.texto}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-700 mb-1">1 · PDF de la liquidación</p>
          <p className="text-xs text-slate-400 mb-4">Se adjunta el mismo archivo a todos los destinatarios.</p>
          {liq.pdf_path ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color="green">PDF adjuntado</Badge>
              <Button size="sm" variant="secondary" onClick={verPdf}>Ver</Button>
              <Button size="sm" variant="ghost" onClick={subirPdf} disabled={busy}><FileUp size={13} /> Reemplazar</Button>
            </div>
          ) : (
            <Button onClick={subirPdf} disabled={busy}><FileUp size={15} /> Adjuntar PDF</Button>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-700 mb-1">2 · Enviar por mail</p>
          <p className="text-xs text-slate-400 mb-4">
            {destinatarios.length} destinatarios con mail{sinMail.length > 0 && <span className="text-amber-600"> · {sinMail.length} UF sin mail (no se les envía)</span>}
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-600 mb-3">
            <input type="checkbox" className="rounded" checked={conPush} onChange={(e) => setConPush(e.target.checked)} />
            Avisar también por la app a quienes la tienen instalada
          </label>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={encolar} disabled={busy || liq.estado === 'abierta' || !liq.pdf_path}><Send size={15} /> {cola.length ? 'Enviar a los que faltan' : 'Enviar expensas'}</Button>
            {cuenta('pendiente') > 0 && <Button variant="secondary" onClick={() => run(procesarCola)} disabled={busy}><RefreshCw size={15} /> Procesar ahora</Button>}
            {cuenta('error') > 0 && <Button variant="secondary" onClick={reintentar} disabled={busy}><RotateCcw size={15} /> Reintentar errores</Button>}
          </div>
          {liq.estado === 'abierta' && <p className="text-xs text-amber-600 mt-2">Cerrá el período para poder enviar.</p>}
        </Card>
      </div>

      {sinMail.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-medium text-amber-700 mb-1">Unidades sin mail cargado</p>
          <p className="text-xs text-slate-500">{sinMail.map((c) => `UF ${c.unidades?.uf} (${c.unidades?.propietario || c.unidades?.depto})`).join(' · ')}</p>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-3 px-4 pt-4 text-xs flex-wrap">
          <Mail size={15} className="text-slate-400" />
          <Badge color="green">{cuenta('enviado')} enviados</Badge>
          <Badge color="amber">{cuenta('pendiente') + cuenta('enviando')} en cola</Badge>
          <Badge color="red">{cuenta('error')} con error</Badge>
          <span className="text-slate-400">La cola se procesa sola cada hora (máximo diario según tu plan de Resend).</span>
        </div>
        {loading ? <Spinner /> : cola.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10">Todavía no se envió esta liquidación.</p>
        ) : (
          <Table headers={['UF', 'Destinatario', 'Mail', 'Estado', 'Enviado', 'Detalle']}>
            {cola.map((c) => {
              const u = ufDe(c.unidad_id);
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{u ? String(u.uf).padStart(3, '0') : '—'}</Td>
                  <Td>{c.nombre || '—'}</Td>
                  <Td className="text-slate-500">{c.email}</Td>
                  <Td><Badge color={estadoColor[c.estado]}>{c.estado}</Badge></Td>
                  <Td className="text-xs text-slate-500">{c.enviado_at ? new Date(c.enviado_at).toLocaleString('es-AR') : '—'}</Td>
                  <Td className="text-xs text-red-500 max-w-xs truncate" >{c.error || ''}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

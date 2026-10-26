// Edge Function: procesa la cola de envíos por mail (expensas y comunicados) con Resend.
// Secretos necesarios (Edge Functions → Secrets):
//   RESEND_API_KEY   la API key de Resend
//   RESEND_FROM      remitente, ej: "Administración <expensas@tudominio.com>"
//   RESEND_REPLY_TO  (opcional) adónde llegan las respuestas, ej: andreamelendrez@hotmail.com
// Opcionales: LIMITE_DIARIO (default 100), POR_CORRIDA (default 40)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Versión en texto plano del HTML (Gmail penaliza los mails que vienen sólo en HTML)
const aTexto = (html: string) => html
  .replace(/<\/(p|div|tr|h\d|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/td>/gi, '  ')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Verifica que quien llama sea un operador habilitado (tabla usuarios)
async function esAdmin(req: Request): Promise<{ ok: boolean; email: string }> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return { ok: false, email: '' };
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) return { ok: false, email: '' };
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data } = await sb.from('usuarios').select('id').ilike('email', user.email).eq('activo', true).maybeSingle();
  return { ok: !!data, email: user.email.toLowerCase() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const FROM = Deno.env.get('RESEND_FROM');
  const REPLY_TO = Deno.env.get('RESEND_REPLY_TO');
  if (!RESEND_API_KEY || !FROM) return json({ error: 'Faltan los secretos RESEND_API_KEY y/o RESEND_FROM en Supabase.' }, 500);
  const LIMITE = Number(Deno.env.get('LIMITE_DIARIO') || 100);
  const VAPID_PUB = Deno.env.get('VAPID_PUBLIC_KEY'), VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY');
  const pushHabilitado = !!(VAPID_PUB && VAPID_PRIV);
  if (pushHabilitado) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:' + (REPLY_TO || 'admin@example.com'), VAPID_PUB!, VAPID_PRIV!);
  const POR_CORRIDA = Number(Deno.env.get('POR_CORRIDA') || 40);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ahora = new Date().toISOString();
  const log: string[] = [];
  const cfg = { from: FROM, reply_to: REPLY_TO || null, limite_diario: LIMITE, por_corrida: POR_CORRIDA };

  // ---- Modo prueba: manda un mail directo y devuelve la respuesta cruda de Resend ----
  let body: { test_email?: string } = {};
  try { body = await req.json(); } catch { /* sin body */ }
  if (body?.test_email) {
    const adm = await esAdmin(req);
    if (!adm.ok) return json({ error: 'Sólo un operador logueado puede mandar mails de prueba.' }, 403);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [body.test_email], subject: 'Comunicación de la administración',
        html: `<p>Hola,</p><p>Le escribimos desde la administración del consorcio para confirmar que esta casilla recibe correctamente nuestras comunicaciones (expensas y avisos).</p><p>Enviado el ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}.</p><p>Saludos cordiales.</p>`,
        text: `Hola,\n\nLe escribimos desde la administración del consorcio para confirmar que esta casilla recibe correctamente nuestras comunicaciones (expensas y avisos).\n\nSaludos cordiales.`,
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
      }),
    });
    const resp = await r.json().catch(() => ({}));
    return json({ prueba: true, ok: r.ok, status: r.status, respuesta_resend: resp, config: cfg });
  }

  // Envíos que quedaron colgados (corrida cortada) vuelven a la cola
  const hace10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await sb.from('cola_envios').update({ estado: 'pendiente' }).eq('estado', 'enviando').lt('procesando_at', hace10);

  // Inicio del día en Argentina (UTC-3)
  const ar = new Date(Date.now() - 3 * 3600e3);
  ar.setUTCHours(0, 0, 0, 0);
  const inicioDia = new Date(ar.getTime() + 3 * 3600e3).toISOString();

  const { count: enviadosHoy } = await sb.from('cola_envios')
    .select('id', { count: 'exact', head: true }).eq('estado', 'enviado').eq('canal', 'mail').gte('enviado_at', inicioDia);
  const disponibles = Math.max(0, LIMITE - (enviadosHoy || 0));

  const contarPendientes = async () =>
    (await sb.from('cola_envios').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')).count || 0;

  // Sólo los que ya pueden salir (sin programar, o con fecha programada cumplida).
  // Los push no cuentan para el límite diario de Resend.
  const { data: pendMail } = disponibles > 0 ? await sb.from('cola_envios').select('*')
    .eq('estado', 'pendiente').eq('canal', 'mail')
    .or(`enviar_desde.is.null,enviar_desde.lte.${ahora}`)
    .order('created_at').limit(Math.min(disponibles, POR_CORRIDA)) : { data: [] };
  const { data: pendPush } = await sb.from('cola_envios').select('*')
    .eq('estado', 'pendiente').eq('canal', 'push')
    .or(`enviar_desde.is.null,enviar_desde.lte.${ahora}`)
    .order('created_at').limit(200);
  const pendientes = [...(pendMail || []), ...(pendPush || [])];
  log.push(`Listos para salir: ${pendMail?.length || 0} mails (cupo de hoy: ${disponibles}) · ${pendPush?.length || 0} push${pushHabilitado ? '' : ' (push NO configurado: faltan claves VAPID)'}`);
  if (disponibles === 0) log.push('Límite diario de mails alcanzado: el resto sale mañana.');

  // Cada adjunto se descarga una sola vez por corrida
  const adjuntos = new Map<string, string | null>();
  const getAdjunto = async (path: string) => {
    if (adjuntos.has(path)) return adjuntos.get(path)!;
    const { data: file } = await sb.storage.from('archivos').download(path);
    const b64 = file ? encodeBase64(new Uint8Array(await file.arrayBuffer())) : null;
    adjuntos.set(path, b64);
    return b64;
  };

  let enviados = 0, errores = 0, frenado = '';
  const comunicadosEnviados = new Set<string>();

  for (const item of pendientes || []) {
    // Se "toma" el registro sólo si sigue pendiente (evita duplicados si corren dos procesos a la vez)
    const { data: tomado } = await sb.from('cola_envios')
      .update({ estado: 'enviando', intentos: item.intentos + 1, procesando_at: new Date().toISOString() })
      .eq('id', item.id).eq('estado', 'pendiente').select('id');
    if (!tomado || tomado.length === 0) continue;

    try {
      // ---- Canal PUSH: notificación a todos los dispositivos del mail ----
      if (item.canal === 'push') {
        if (!pushHabilitado) throw new Error('Push no configurado (faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).');
        const { data: subs } = await sb.from('push_suscripciones').select('*').ilike('email', item.email).eq('activa', true);
        if (!subs || subs.length === 0) throw new Error('El destinatario no tiene la app instalada (sin dispositivos).');
        const payload = JSON.stringify({ title: item.push_titulo || item.asunto, body: item.push_cuerpo || '', url: item.push_url || '/portal/' });
        let okDisp = 0; const fallas: string[] = [];
        for (const sub of subs) {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 });
            okDisp++;
          } catch (e) {
            const st = (e as { statusCode?: number }).statusCode;
            const msg = `${st || ''} ${(e as Error).message || ''}`.trim();
            fallas.push(msg);
            if (st === 404 || st === 410) await sb.from('push_suscripciones').update({ activa: false, ultimo_error: msg }).eq('id', sub.id); // dispositivo dado de baja
            else await sb.from('push_suscripciones').update({ ultimo_error: msg }).eq('id', sub.id);
          }
        }
        if (okDisp === 0) throw new Error(`Ningún dispositivo recibió la notificación: ${fallas.join(' | ')}`);
        await sb.from('cola_envios').update({ estado: 'enviado', enviado_at: new Date().toISOString(), resend_id: `push:${okDisp}/${subs.length}`, error: fallas.length ? fallas.join(' | ') : null }).eq('id', item.id);
        if (item.comunicado_id) comunicadosEnviados.add(item.comunicado_id);
        log.push(`PUSH OK → ${item.email} (${okDisp}/${subs.length} dispositivos)`);
        enviados++;
        continue;
      }

      // ---- Canal MAIL ----
      // Adjunto: el del registro; para expensas viejas, el PDF de la liquidación
      let path: string | null = item.adjunto_path;
      if (!path && item.liquidacion_id) {
        const { data: liq } = await sb.from('liquidaciones').select('pdf_path').eq('id', item.liquidacion_id).single();
        path = liq?.pdf_path || null;
      }
      if (item.liquidacion_id && !path) throw new Error('La liquidación no tiene PDF adjunto.');

      const attachments: { filename: string; content: string }[] = [];
      if (path) {
        const contenido = await getAdjunto(path);
        if (!contenido) throw new Error('No se pudo leer el archivo adjunto.');
        attachments.push({ filename: item.adjunto_nombre || path.split('/').pop() || 'adjunto.pdf', content: contenido });
      }

      // Remitente con el nombre de la administración del consorcio (multi-administración); la casilla es la del dominio verificado
      let from = FROM, replyTo = REPLY_TO || null;
      if (item.consorcio_id) {
        const { data: c } = await sb.from('consorcios').select('administracion(nombre, email)').eq('id', item.consorcio_id).maybeSingle();
        const a = (c?.administracion as unknown as { nombre?: string; email?: string } | null);
        const direccion = FROM.match(/<([^>]+)>/)?.[1] || FROM;
        if (a?.nombre) from = `${a.nombre.replace(/[<>"]/g, '')} <${direccion}>`;
        if (a?.email) replyTo = a.email;
      }
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [item.email], subject: item.asunto, html: item.html, text: aTexto(item.html),
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(attachments.length ? { attachments } : {}),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 429) {
        // Límite de Resend alcanzado: se devuelve a la cola y se corta la corrida
        await sb.from('cola_envios').update({ estado: 'pendiente' }).eq('id', item.id);
        frenado = 'Resend pidió frenar (límite alcanzado). Se sigue en la próxima corrida.';
        break;
      }
      if (!r.ok) throw new Error(`Resend ${r.status}: ${body?.message || body?.name || JSON.stringify(body)}`);
      log.push(`OK → ${item.email} (id ${body.id || '?'})`);
      await sb.from('cola_envios').update({ estado: 'enviado', enviado_at: new Date().toISOString(), resend_id: body.id || null, error: null }).eq('id', item.id);
      if (item.comunicado_id) comunicadosEnviados.add(item.comunicado_id);
      enviados++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sb.from('cola_envios').update({ estado: 'error', error: msg }).eq('id', item.id);
      log.push(`ERROR → ${item.email}: ${msg}`);
      errores++;
    }
    if (item.canal !== 'push') await sleep(600); // Resend permite ~2 por segundo
  }

  // Comunicados que salieron: pasan a "Enviado" y se actualiza el último envío
  if (comunicadosEnviados.size) {
    await sb.from('comunicados').update({ estado: 'enviado', ultimo_envio: new Date().toISOString() }).in('id', [...comunicadosEnviados]);
  }

  return json({ enviados, errores, quedan: await contarPendientes(), enviadosHoy: (enviadosHoy || 0) + enviados, limite: LIMITE, mensaje: frenado || undefined, config: cfg, log });
});

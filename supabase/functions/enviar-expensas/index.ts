// Edge Function: procesa la cola de envíos por mail (expensas y comunicados) con Resend.
// Secretos necesarios (Edge Functions → Secrets):
//   RESEND_API_KEY   la API key de Resend
//   RESEND_FROM      remitente, ej: "Administración <expensas@tudominio.com>"
//   RESEND_REPLY_TO  (opcional) adónde llegan las respuestas, ej: andreamelendrez@hotmail.com
// Opcionales: LIMITE_DIARIO (default 100), POR_CORRIDA (default 40)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const FROM = Deno.env.get('RESEND_FROM');
  const REPLY_TO = Deno.env.get('RESEND_REPLY_TO');
  if (!RESEND_API_KEY || !FROM) return json({ error: 'Faltan los secretos RESEND_API_KEY y/o RESEND_FROM en Supabase.' }, 500);
  const LIMITE = Number(Deno.env.get('LIMITE_DIARIO') || 100);
  const POR_CORRIDA = Number(Deno.env.get('POR_CORRIDA') || 40);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ahora = new Date().toISOString();

  // Envíos que quedaron colgados (corrida cortada) vuelven a la cola
  const hace10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await sb.from('cola_envios').update({ estado: 'pendiente' }).eq('estado', 'enviando').lt('procesando_at', hace10);

  // Inicio del día en Argentina (UTC-3)
  const ar = new Date(Date.now() - 3 * 3600e3);
  ar.setUTCHours(0, 0, 0, 0);
  const inicioDia = new Date(ar.getTime() + 3 * 3600e3).toISOString();

  const { count: enviadosHoy } = await sb.from('cola_envios')
    .select('id', { count: 'exact', head: true }).eq('estado', 'enviado').gte('enviado_at', inicioDia);
  const disponibles = Math.max(0, LIMITE - (enviadosHoy || 0));

  const contarPendientes = async () =>
    (await sb.from('cola_envios').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')).count || 0;

  if (disponibles === 0) {
    return json({ enviados: 0, errores: 0, quedan: await contarPendientes(), enviadosHoy, limite: LIMITE, mensaje: 'Límite diario alcanzado: el resto sale mañana.' });
  }

  // Sólo los que ya pueden salir (sin programar, o con fecha programada cumplida)
  const { data: pendientes } = await sb.from('cola_envios').select('*')
    .eq('estado', 'pendiente')
    .or(`enviar_desde.is.null,enviar_desde.lte.${ahora}`)
    .order('created_at').limit(Math.min(disponibles, POR_CORRIDA));

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

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [item.email], subject: item.asunto, html: item.html,
          ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
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
      if (!r.ok) throw new Error(body?.message || `Resend respondió ${r.status}`);
      await sb.from('cola_envios').update({ estado: 'enviado', enviado_at: new Date().toISOString(), resend_id: body.id || null, error: null }).eq('id', item.id);
      if (item.comunicado_id) comunicadosEnviados.add(item.comunicado_id);
      enviados++;
    } catch (e) {
      await sb.from('cola_envios').update({ estado: 'error', error: e instanceof Error ? e.message : String(e) }).eq('id', item.id);
      errores++;
    }
    await sleep(600); // Resend permite ~2 por segundo
  }

  // Comunicados que salieron: pasan a "Enviado" y se actualiza el último envío
  if (comunicadosEnviados.size) {
    await sb.from('comunicados').update({ estado: 'enviado', ultimo_envio: new Date().toISOString() }).in('id', [...comunicadosEnviados]);
  }

  return json({ enviados, errores, quedan: await contarPendientes(), enviadosHoy: (enviadosHoy || 0) + enviados, limite: LIMITE, mensaje: frenado || undefined });
});

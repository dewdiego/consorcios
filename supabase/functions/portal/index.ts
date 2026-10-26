// Edge Function: backend del Portal del propietario (PWA).
// El portal nunca toca las tablas directamente: todo pasa por acá, y sólo devuelve datos del mail logueado.
// Acciones (POST { accion, ... }):
//   verificar     { email }            → ¿el mail está cargado en alguna unidad? (antes de mandar el código)
//   mis-datos                          → unidades, última expensa y comunicados del usuario (requiere sesión)
//   suscribir     { suscripcion, ua }  → registra el dispositivo para push (requiere sesión)
//   desuscribir   { endpoint }         → da de baja el dispositivo (requiere sesión)
//   vapid                              → clave pública VAPID para el navegador
//   ver-como      { email }            → lo mismo que mis-datos pero para otro mail; sólo para administradores (tabla usuarios)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Unidades donde figura el mail (como propietario o inquilino) */
async function unidadesDe(sb: ReturnType<typeof createClient>, email: string) {
  const e = email.trim().toLowerCase();
  const { data } = await sb.from('unidades')
    .select('id, uf, depto, piso, propietario, propietario_email, inquilino, inquilino_email, alquilada, consorcio_id, consorcios(id, nombre, direccion, administracion_id)')
    .eq('activo', true)
    .or(`propietario_email.ilike.${e},inquilino_email.ilike.${e}`);
  return (data || []) as unknown as {
    id: string; uf: number; depto: string; piso: string | null; propietario: string | null; propietario_email: string | null;
    inquilino: string | null; inquilino_email: string | null; alquilada: boolean; consorcio_id: string;
    consorcios: { id: string; nombre: string; direccion: string | null; administracion_id: string | null } | null;
  }[];
}

/** Todo lo que ve un vecino en el portal: unidades con su última expensa, comunicados, info útil. */
async function datosDe(sb: ReturnType<typeof createClient>, email: string) {
    const us = await unidadesDe(sb, email);
    if (us.length === 0) return { error: 'Tu mail ya no figura en ninguna unidad.' };
    const consorcioIds = [...new Set(us.map((u) => u.consorcio_id))];
    // Administraciones de esos consorcios: lo "general" (sin consorcio) se filtra por ellas, para no mezclar administradoras
    const admIds = [...new Set(us.map((u) => u.consorcios?.administracion_id).filter(Boolean))] as string[];
    const generalDe = (col = 'consorcio_id') => admIds.length ? `${col}.in.(${consorcioIds.join(',')}),and(${col}.is.null,administracion_id.in.(${admIds.join(',')}))` : `${col}.in.(${consorcioIds.join(',')})`;

    // Última liquidación cerrada/enviada de cada consorcio + el cupón de cada unidad
    const { data: liqs } = await sb.from('liquidaciones')
      .select('id, consorcio_id, periodo, estado, fecha_vencimiento_1, fecha_vencimiento_2, pdf_path')
      .in('consorcio_id', consorcioIds).neq('estado', 'abierta').order('periodo', { ascending: false });
    const ultimaPorConsorcio = new Map<string, NonNullable<typeof liqs>[number]>();
    for (const l of liqs || []) if (!ultimaPorConsorcio.has(l.consorcio_id)) ultimaPorConsorcio.set(l.consorcio_id, l);
    const liqIds = [...ultimaPorConsorcio.values()].map((l) => l.id);
    const { data: cupones } = liqIds.length
      ? await sb.from('cupones').select('liquidacion_id, unidad_id, saldo_anterior, intereses, total, total_2do_venc, estado').in('liquidacion_id', liqIds).in('unidad_id', us.map((u) => u.id))
      : { data: [] };
    const { data: pagos } = await sb.from('pagos').select('unidad_id, fecha, monto, metodo').in('unidad_id', us.map((u) => u.id)).order('fecha', { ascending: false }).limit(30);

    const unidades = us.map((u) => {
      const liq = ultimaPorConsorcio.get(u.consorcio_id);
      const cupon = (cupones || []).find((c) => c.unidad_id === u.id && c.liquidacion_id === liq?.id) || null;
      let pdf_url: string | null = null;
      if (liq?.pdf_path) {
        const { data } = sb.storage.from('archivos').getPublicUrl(liq.pdf_path);
        pdf_url = data.publicUrl;
      }
      return {
        id: u.id, uf: u.uf, depto: u.depto, consorcio: u.consorcios?.nombre, direccion: u.consorcios?.direccion,
        rol: (u.propietario_email || '').toLowerCase() === email ? 'propietario' : 'inquilino',
        nombre: (u.propietario_email || '').toLowerCase() === email ? u.propietario : u.inquilino,
        expensa: liq ? { periodo: liq.periodo, estado: liq.estado, vencimiento_1: liq.fecha_vencimiento_1, vencimiento_2: liq.fecha_vencimiento_2, pdf_url, cupon } : null,
        pagos: (pagos || []).filter((p) => p.unidad_id === u.id).slice(0, 6),
      };
    });

    const { data: comunicados } = await sb.from('comunicados')
      .select('id, titulo, contenido, tipo, fecha_publicacion, consorcio_id, adjunto_path, consorcios(nombre)')
      .eq('seccion', 'comunicados').eq('activo', true).neq('estado', 'borrador')
      .or(generalDe())
      .order('fecha_publicacion', { ascending: false }).limit(30);
    const coms = (comunicados || []).map((c) => ({
      ...c, consorcio: (c.consorcios as unknown as { nombre: string } | null)?.nombre || 'Todos', consorcios: undefined,
      adjunto_url: c.adjunto_path ? sb.storage.from('archivos').getPublicUrl(c.adjunto_path).data.publicUrl : null,
    }));

    const { data: subs } = await sb.from('push_suscripciones').select('endpoint').ilike('email', email).eq('activa', true);
    const { data: adm } = admIds.length
      ? await sb.from('administracion').select('nombre, telefono, email, direccion, horario_atencion').eq('id', admIds[0]).maybeSingle()
      : await sb.from('administracion').select('nombre, telefono, email, direccion, horario_atencion').limit(1).maybeSingle();
    // Info útil: administración, datos cargados por el admin y teléfonos (generales + del consorcio)
    const [{ data: info }, { data: tels }] = await Promise.all([
      sb.from('portal_info').select('titulo, contenido, consorcio_id, consorcios(nombre)').eq('activo', true).or(generalDe()).order('orden').order('created_at'),
      sb.from('telefonos').select('nombre, categoria, telefono, notas, consorcio_id, consorcios(nombre)').eq('visible_portal', true).or(generalDe()).order('categoria').order('nombre'),
    ]);
    const conNombre = <T extends { consorcios?: unknown }>(x: T) => ({ ...x, consorcio: (x.consorcios as { nombre: string } | null)?.nombre || null, consorcios: undefined });
    return { email, unidades, comunicados: coms, dispositivos: (subs || []).length, administracion: adm, info: (info || []).map(conNombre), telefonos: (tels || []).map(conNombre) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const accion = String(body.accion || '');
  const sb = createClient(URL_SB, SERVICE);

  if (accion === 'vapid') return json({ clave: Deno.env.get('VAPID_PUBLIC_KEY') || null });

  if (accion === 'verificar') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return json({ ok: false, error: 'Ingresá un mail válido.' });
    const us = await unidadesDe(sb, email);
    if (us.length === 0) return json({ ok: false, error: 'Ese mail no figura en ninguna unidad. Pedile a la administración que lo cargue.' });
    return json({ ok: true, consorcios: [...new Set(us.map((u) => u.consorcios?.nombre))] });
  }

  // ---- Acciones con sesión: el usuario viene en el JWT ----
  const auth = req.headers.get('Authorization') || '';
  const userClient = createClient(URL_SB, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) return json({ error: 'Sesión inválida. Volvé a ingresar.' }, 401);
  const email = user.email.toLowerCase();

  if (accion === 'mis-datos') {
    const d = await datosDe(sb, email);
    return 'error' in d ? json(d, 403) : json(d);
  }

  if (accion === 'ver-como') {
    // Sólo administradores (mail en la tabla usuarios, activo)
    const { data: adm } = await sb.from('usuarios').select('id').ilike('email', email).eq('activo', true).maybeSingle();
    if (!adm) return json({ error: 'Sólo para administradores.' }, 403);
    const objetivo = String(body.email || '').trim().toLowerCase();
    if (!objetivo.includes('@')) return json({ error: 'Indicá el mail del vecino.' }, 400);
    const d = await datosDe(sb, objetivo);
    return 'error' in d ? json(d, 404) : json(d);
  }

  if (accion === 'suscribir') {
    const s = body.suscripcion as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'Suscripción inválida.' }, 400);
    const { error } = await sb.from('push_suscripciones').upsert({
      email, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: String(body.ua || '').slice(0, 200), activa: true, ultimo_error: null,
    }, { onConflict: 'endpoint' });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (accion === 'desuscribir') {
    await sb.from('push_suscripciones').update({ activa: false }).eq('endpoint', String(body.endpoint || '')).ilike('email', email);
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida' }, 400);
});

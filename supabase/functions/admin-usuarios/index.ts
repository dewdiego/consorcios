// Edge Function: alta y baja de operadores de la administración.
// La app no puede crear cuentas de Auth con la clave pública, por eso pasa por acá (clave de servicio).
// Acciones (POST { accion, ... }, con el token del operador logueado):
//   invitar  { email, nombre, rol, administracion_id?, superadmin? } → crea la fila en `usuarios` y manda el mail de invitación
//   eliminar { email }                                               → borra la fila y la cuenta de Auth
// Reglas: sólo administradores (rol admin). Un admin común sólo opera sobre su propia administración y no puede dar superadmin.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const sb = createClient(URL_SB, SERVICE);

  // Quién llama
  const userClient = createClient(URL_SB, ANON, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) return json({ error: 'Sesión inválida.' }, 401);
  const { data: yo } = await sb.from('usuarios').select('rol, activo, superadmin, administracion_id').ilike('email', user.email).maybeSingle();
  if (!yo?.activo || yo.rol !== 'admin') return json({ error: 'Sólo un administrador puede gestionar usuarios.' }, 403);

  const accion = String(body.accion || '');
  const email = String(body.email || '').trim().toLowerCase();
  if (!email.includes('@')) return json({ error: 'Mail inválido.' }, 400);

  if (accion === 'invitar') {
    const administracion_id = yo.superadmin && body.administracion_id ? String(body.administracion_id) : yo.administracion_id;
    const superadmin = yo.superadmin ? !!body.superadmin : false;
    const rol = ['admin', 'operador', 'consulta'].includes(String(body.rol)) ? String(body.rol) : 'operador';
    const { error: uErr } = await sb.from('usuarios').upsert({ email, nombre: String(body.nombre || email), rol, activo: true, administracion_id, superadmin }, { onConflict: 'email' });
    if (uErr) return json({ error: uErr.message }, 500);
    const redirectTo = String(body.redirect || '') || undefined;
    const { error: iErr } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo, data: { nombre: body.nombre } });
    if (iErr) {
      const yaExiste = /already|registered|exists/i.test(iErr.message);
      if (!yaExiste) return json({ error: `Usuario cargado, pero no se pudo mandar la invitación: ${iErr.message}` }, 500);
      // Ya tenía cuenta (por ejemplo, era vecino del portal): le mandamos un link para elegir contraseña
      await sb.auth.resetPasswordForEmail(email, { redirectTo });
      return json({ ok: true, mensaje: `${email} ya tenía cuenta: quedó habilitado. Puede entrar con su contraseña o usar "Olvidé mi contraseña".` });
    }
    return json({ ok: true, mensaje: `Invitación enviada a ${email}. Al abrir el link elige su contraseña y entra.` });
  }

  if (accion === 'eliminar') {
    if (email === user.email.toLowerCase()) return json({ error: 'No podés eliminarte a vos mismo.' }, 400);
    const { data: obj } = await sb.from('usuarios').select('administracion_id, superadmin').ilike('email', email).maybeSingle();
    if (!obj) return json({ error: 'No existe ese usuario.' }, 404);
    if (!yo.superadmin && (obj.administracion_id !== yo.administracion_id || obj.superadmin)) return json({ error: 'No podés eliminar usuarios de otra administración.' }, 403);
    await sb.from('usuarios').delete().ilike('email', email);
    // Cuenta de Auth: sólo si no es también vecino del portal (si tiene unidad, se la dejamos para que siga entrando al portal)
    const { data: unid } = await sb.from('unidades').select('id').or(`propietario_email.ilike.${email},inquilino_email.ilike.${email}`).limit(1);
    if (!unid?.length) {
      const { data: lista } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const au = lista?.users.find((x) => (x.email || '').toLowerCase() === email);
      if (au) await sb.auth.admin.deleteUser(au.id);
    }
    return json({ ok: true });
  }
  return json({ error: 'Acción desconocida' }, 400);
});

// URL pública del portal del propietario (PWA). Es adonde llevan las notificaciones push.
export const PORTAL_URL = 'https://grupoamel.com.ar/portal/';

/** Mails (en minúscula) que tienen la app instalada con notificaciones activas */
export async function emailsConApp(sb: import('@supabase/supabase-js').SupabaseClient): Promise<Set<string>> {
  const { data } = await sb.from('push_emails').select('email');
  return new Set(((data as { email: string }[]) || []).map((r) => r.email));
}

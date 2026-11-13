// URL pública del portal del propietario (PWA). Es adonde llevan las notificaciones push.
export const PORTAL_URL = 'https://grupoamel.com.ar/portal/';

/*
  Vista del menú: por defecto todos ven la AGRUPADA. La vista clásica (tipo Octavo Piso) sólo la pueden elegir,
  desde Configuración → Apariencia, el superadmin y los mails de esta lista (en minúscula).
*/
export const VISTA_CLASICA_EMAILS: string[] = [
  // 'am.andreamelendrez@gmail.com',
];
export const puedeElegirVista = (email: string, superadmin: boolean) => superadmin || VISTA_CLASICA_EMAILS.includes((email || '').toLowerCase());
export const vistaGuardada = (): 'clasica' | 'amel' => { try { return localStorage.getItem('ui_vista') === 'clasica' ? 'clasica' : 'amel'; } catch { return 'amel'; } };

/** Mails (en minúscula) que tienen la app instalada con notificaciones activas */
export async function emailsConApp(sb: import('@supabase/supabase-js').SupabaseClient): Promise<Set<string>> {
  const { data } = await sb.from('push_emails').select('email');
  return new Set(((data as { email: string }[]) || []).map((r) => r.email));
}

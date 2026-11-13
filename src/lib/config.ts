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
let vistaEnMemoria: 'clasica' | 'amel' | null = null;
export const vistaGuardada = (): 'clasica' | 'amel' => {
  if (vistaEnMemoria) return vistaEnMemoria;
  try { return localStorage.getItem('ui_vista') === 'clasica' ? 'clasica' : 'amel'; } catch { return 'amel'; }
};
/** Cambia la vista al instante (sin recargar) y la deja guardada en este dispositivo. */
export const elegirVista = (v: 'clasica' | 'amel') => {
  vistaEnMemoria = v;
  try { localStorage.setItem('ui_vista', v); } catch { /* noop */ }
  window.dispatchEvent(new Event('ui_vista'));
};
/** Para que las pantallas se redibujen cuando cambia la vista. */
export const alCambiarVista = (fn: () => void) => { window.addEventListener('ui_vista', fn); return () => window.removeEventListener('ui_vista', fn); };

/** Mails (en minúscula) que tienen la app instalada con notificaciones activas */
export async function emailsConApp(sb: import('@supabase/supabase-js').SupabaseClient): Promise<Set<string>> {
  const { data } = await sb.from('push_emails').select('email');
  return new Set(((data as { email: string }[]) || []).map((r) => r.email));
}

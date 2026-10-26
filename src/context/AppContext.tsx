import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Consorcio } from '@/lib/supabase';

type EstadoAuth = 'cargando' | 'anonimo' | 'sin_permiso' | 'ok';

type AppCtx = {
  consorcios: Consorcio[];
  consorcio: Consorcio | null;             // consorcio activo (contexto de trabajo)
  setConsorcioId: (id: string | null) => void;
  reloadConsorcios: () => Promise<void>;
  usuario: string;                          // nombre del operador logueado (para auditoría)
  setUsuario: (n: string) => void;
  email: string;
  rol: string;
  superadmin: boolean;
  administracionId: string | null;
  elegirContrasena: boolean;              // llegó por link de invitación / recuperación: tiene que definir contraseña
  setElegirContrasena: (v: boolean) => void;
  estadoAuth: EstadoAuth;
  cerrarSesion: () => Promise<void>;
};

const Ctx = createContext<AppCtx>(null as unknown as AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [consorcios, setConsorcios] = useState<Consorcio[]>([]);
  const [consorcioId, setConsorcioIdState] = useState<string | null>(() => {
    try { return localStorage.getItem('consorcio_activo'); } catch { return null; }
  });
  const [usuario, setUsuarioState] = useState('Administrador');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState('');
  const [superadmin, setSuperadmin] = useState(false);
  const [administracionId, setAdministracionId] = useState<string | null>(null);
  const [elegirContrasena, setElegirContrasena] = useState(() => /type=(invite|recovery|magiclink)/.test(window.location.hash));
  const [estadoAuth, setEstadoAuth] = useState<EstadoAuth>('cargando');
  const emailRef = useRef('');
  useEffect(() => { emailRef.current = email; }, [email]);

  const reloadConsorcios = async () => {
    const { data } = await supabase.from('consorcios').select('*').order('nombre');
    setConsorcios((data as Consorcio[]) || []);
  };

  /** Corta una promesa que no responde (la librería de auth a veces se traba esperando un lock en el celular) */
  const conTimeout = <T,>(p: PromiseLike<T>, ms: number) =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  /** Con sesión: verifica que el mail sea un operador habilitado (tabla usuarios) */
  const resolverSesion = async (session: Session | null) => {
    if (!session?.user?.email) { setEstadoAuth('anonimo'); setEmail(''); setConsorcios([]); return; }
    const mail = session.user.email.toLowerCase();
    setEmail(mail);
    try {
      // Con las políticas cerradas, un vecino logueado no puede leer "usuarios" → data vacía → sin permiso
      const { data } = await conTimeout(supabase.from('usuarios').select('nombre, rol, activo, superadmin, administracion_id').ilike('email', mail).maybeSingle(), 15000);
      if (!data || !data.activo) { setEstadoAuth('sin_permiso'); return; }
      setUsuarioState(data.nombre || mail);
      setRol(data.rol || 'operador');
      setSuperadmin(!!data.superadmin);
      setAdministracionId(data.administracion_id || null);
      setEstadoAuth('ok');
      await reloadConsorcios();
    } catch {
      // Sin respuesta: se recarga una vez; si vuelve a fallar, se muestra el login en vez de quedar en blanco
      recargarUnaVez();
    }
  };

  const recargarUnaVez = () => {
    let ya = false;
    try { ya = sessionStorage.getItem('auth_reintento') === '1'; if (!ya) sessionStorage.setItem('auth_reintento', '1'); } catch { /* noop */ }
    if (ya) setEstadoAuth('anonimo'); else location.reload();
  };

  useEffect(() => {
    conTimeout(supabase.auth.getSession(), 10000)
      .then(({ data: { session } }) => resolverSesion(session))
      .catch(() => recargarUnaVez());
    const { data: sub } = supabase.auth.onAuthStateChange((evento, session) => {
      // setTimeout: nunca llamar a supabase dentro del callback de auth (se traba con su propio lock)
      if (evento === 'PASSWORD_RECOVERY') setElegirContrasena(true);
      if (evento === 'SIGNED_OUT') setTimeout(() => resolverSesion(null), 0);
      else if (evento === 'SIGNED_IN' || evento === 'USER_UPDATED') {
        const nuevoMail = session?.user?.email?.toLowerCase() || '';
        setTimeout(() => setEstadoAuth((e) => { if (e === 'ok' && nuevoMail === emailRef.current) return e; resolverSesion(session); return e; }), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (estadoAuth === 'ok') try { sessionStorage.removeItem('auth_reintento'); } catch { /* noop */ } }, [estadoAuth]);


  const setConsorcioId = (id: string | null) => {
    setConsorcioIdState(id);
    try { id ? localStorage.setItem('consorcio_activo', id) : localStorage.removeItem('consorcio_activo'); } catch { /* noop */ }
  };

  const cerrarSesion = async () => { await supabase.auth.signOut(); setEstadoAuth('anonimo'); };

  const consorcio = consorcios.find((c) => c.id === consorcioId) || null;

  return (
    <Ctx.Provider value={{ consorcios, consorcio, setConsorcioId, reloadConsorcios, usuario, setUsuario: setUsuarioState, email, rol, superadmin, administracionId, elegirContrasena, setElegirContrasena, estadoAuth, cerrarSesion }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);

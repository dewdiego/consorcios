import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, type Consorcio } from '@/lib/supabase';

type AppCtx = {
  consorcios: Consorcio[];
  consorcio: Consorcio | null;             // consorcio activo (contexto de trabajo)
  setConsorcioId: (id: string | null) => void;
  reloadConsorcios: () => Promise<void>;
  usuario: string;                          // nombre del operador (para auditoría simple)
  setUsuario: (n: string) => void;
};

const Ctx = createContext<AppCtx>(null as unknown as AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [consorcios, setConsorcios] = useState<Consorcio[]>([]);
  const [consorcioId, setConsorcioIdState] = useState<string | null>(() => {
    try { return localStorage.getItem('consorcio_activo'); } catch { return null; }
  });
  const [usuario, setUsuarioState] = useState<string>(() => {
    try { return localStorage.getItem('usuario_nombre') || 'Administrador'; } catch { return 'Administrador'; }
  });

  const reloadConsorcios = async () => {
    const { data } = await supabase.from('consorcios').select('*').order('nombre');
    setConsorcios((data as Consorcio[]) || []);
  };

  useEffect(() => { reloadConsorcios(); }, []);

  const setConsorcioId = (id: string | null) => {
    setConsorcioIdState(id);
    try { id ? localStorage.setItem('consorcio_activo', id) : localStorage.removeItem('consorcio_activo'); } catch { /* noop */ }
  };

  const setUsuario = (n: string) => {
    setUsuarioState(n);
    try { localStorage.setItem('usuario_nombre', n); } catch { /* noop */ }
  };

  const consorcio = consorcios.find((c) => c.id === consorcioId) || null;

  return <Ctx.Provider value={{ consorcios, consorcio, setConsorcioId, reloadConsorcios, usuario, setUsuario }}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);

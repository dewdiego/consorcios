import { useState, type ReactNode } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';

/** Cuadro de ayuda plegable: qué hacer en esta pantalla y qué viene después (presentaciones, a quién mandar qué). */
export function Ayuda({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  const clave = `ayuda_cerrada_${id}`;
  const [abierto, setAbierto] = useState(() => { try { return localStorage.getItem(clave) !== '1'; } catch { return true; } });
  const toggle = () => { setAbierto((a) => { try { localStorage.setItem(clave, a ? '1' : '0'); } catch { /* noop */ } return !a; }); };
  return (
    <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/70 text-sm text-slate-700">
      <button onClick={toggle} className="w-full flex items-center gap-2 px-4 py-2 text-left font-medium text-sky-800">
        <Lightbulb size={15} className="text-sky-500" /> {titulo}
        <ChevronDown size={15} className={`ml-auto transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && <div className="px-4 pb-3 space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_b]:text-slate-900">{children}</div>}
    </div>
  );
}

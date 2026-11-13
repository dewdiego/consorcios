import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/*
  Cintita "Instalá la app": aparece abajo cuando el panel está abierto en el navegador y todavía no está instalado.
  - Android / Chrome / Edge: botón Instalar (usa el aviso nativo del navegador).
  - iPhone / iPad: explica el camino Compartir → Agregar a inicio, porque Safari no deja instalar con un botón.
  Si la cierran, no vuelve a aparecer en ese dispositivo por 30 días.
*/
type AvisoInstalacion = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// El navegador puede avisar antes de que React termine de montar: se guarda apenas llega.
let avisoGuardado: AvisoInstalacion | null = null;
const oyentes = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); avisoGuardado = e as AvisoInstalacion; oyentes.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { avisoGuardado = null; oyentes.forEach((f) => f()); });
}

const CLAVE = 'instalar_cerrado';
const cerradaHacePoco = () => { try { return Date.now() - Number(localStorage.getItem(CLAVE) || 0) < 30 * 24 * 3600 * 1000; } catch { return false; } };
const yaInstalada = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function InstalarApp() {
  const [, redibujar] = useState(0);
  const [cerrada, setCerrada] = useState(cerradaHacePoco);
  useEffect(() => { const f = () => redibujar((n) => n + 1); oyentes.add(f); return () => { oyentes.delete(f); }; }, []);

  if (cerrada || yaInstalada()) return null;
  const ios = esIOS();
  if (!avisoGuardado && !ios) return null;

  const cerrar = () => { try { localStorage.setItem(CLAVE, String(Date.now())); } catch { /* noop */ } setCerrada(true); };
  const instalar = async () => {
    const aviso = avisoGuardado; if (!aviso) return;
    await aviso.prompt();
    const { outcome } = await aviso.userChoice;
    avisoGuardado = null;
    if (outcome === 'accepted') setCerrada(true); else redibujar((n) => n + 1);
  };

  return (
    <div className="fixed bottom-3 inset-x-3 sm:left-auto sm:right-4 sm:w-[380px] z-50 bg-[#12284f] text-white rounded-xl shadow-lg flex items-center gap-3 px-3 py-2.5" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
      <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-lg shrink-0" />
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <p className="font-semibold">Instalá Gestión Íntegra</p>
        <p className="text-slate-300">{ios ? 'Tocá Compartir y después "Agregar a inicio".' : 'Abrila como una app, sin la barra del navegador.'}</p>
      </div>
      {!ios && <button onClick={instalar} className="shrink-0 bg-[#2bb8b4] text-[#06263a] font-semibold text-sm rounded-lg px-3 py-1.5 hover:brightness-110">Instalar</button>}
      <button onClick={cerrar} title="Cerrar" aria-label="Cerrar" className="shrink-0 p-1 rounded hover:bg-white/15"><X size={16} /></button>
    </div>
  );
}

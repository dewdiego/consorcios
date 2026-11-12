/* Marca "Gestión Íntegra 4.0": hexágono con G, degradé azul → teal. `claro` la dibuja en blanco para fondos oscuros. */
export function LogoMarca({ size = 28, claro = false }: { size?: number; claro?: boolean }) {
  const id = claro ? 'gi-claro' : 'gi-color';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          {claro ? <><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#5fe0d8" /></> : <><stop offset="0" stopColor="#173a7a" /><stop offset=".55" stopColor="#1f6fd0" /><stop offset="1" stopColor="#2bb8b4" /></>}
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${id})`} strokeWidth="8" strokeLinejoin="round" strokeLinecap="round">
        <path d="M50 6 88.1 28V72L50 94 11.9 72V28Z" />
        <path d="M70.8 38 50 26 29.2 38V62L50 74 70.8 62V50H52" />
      </g>
    </svg>
  );
}

export function LogoNombre({ claro = false, sub = 'Consultoría Digital y Procesos' }: { claro?: boolean; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className={`font-extrabold leading-tight tracking-tight whitespace-nowrap ${claro ? 'text-white' : 'text-[#173a7a]'}`}>
        GESTIÓN ÍNTEGRA <span className="ml-0.5 align-middle text-[10px] font-bold rounded px-1 py-0.5 bg-[#1f6fd0] text-white">4.0</span>
      </p>
      <p className={`text-[11px] truncate ${claro ? 'text-slate-300' : 'text-slate-400'}`}>{sub}</p>
    </div>
  );
}

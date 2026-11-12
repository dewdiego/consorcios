import { type ReactNode, useState } from 'react';
import {
  Archive, BarChart3, Bell, Building2, CalendarDays, ChevronDown, ChevronRight, ClipboardList,
  FileBarChart, LayoutDashboard, LogOut, Megaphone, Menu, Home, Phone, Receipt, Settings, ShoppingCart,
  Truck, Users, Vote, WalletCards, Wrench, Zap, Hammer
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { LogoMarca, LogoNombre } from '@/components/Logo';
import { puedeElegirVista, vistaGuardada } from '@/lib/config';

export type PageKey =
  | 'config' | 'consorcios' | 'mis_facturas' | 'notificaciones' | 'envios_mail' | 'portal' | 'usuarios' | 'export_datos'
  | 'tablero'
  | 'acciones_masivas'
  | 'prov_listado' | 'prov_movimientos' | 'prov_documentos'
  | 'reportes'
  | 'noticias'
  | 'consultas'
  | 'reclamos'
  | 'compras'
  | 'unidades'
  | 'mantenimientos' | 'trabajos'
  | 'exp_liquidaciones' | 'exp_gastos' | 'exp_provisiones' | 'exp_ordenes_pago' | 'exp_cheques' | 'exp_planes' | 'exp_ctacte'
  | 'sueldos'
  | 'contabilidad'
  | 'calendario'
  | 'archivos'
  | 'telefonos'
  | 'encuestas';

type NavChild = { key: PageKey; label: string };
type NavEntry = { label: string; icon: ReactNode; key?: PageKey; children?: NavChild[]; porConsorcio?: boolean };

const NAV: NavEntry[] = [
  { label: 'Mi Administración', icon: <Settings size={17} />, children: [
    { key: 'config', label: 'Configuración' },
    { key: 'consorcios', label: 'Consorcios' },
    { key: 'mis_facturas', label: 'Mis facturas' },
    { key: 'notificaciones', label: 'Notificaciones' },
    { key: 'envios_mail', label: 'Envíos de mail' },
    { key: 'portal', label: 'Portal de vecinos' },
    { key: 'usuarios', label: 'Usuarios' },
    { key: 'export_datos', label: 'Export datos' },
  ] },
  { label: 'Tablero de control', icon: <LayoutDashboard size={17} />, key: 'tablero' },
  { label: 'Acciones Masivas', icon: <Zap size={17} />, key: 'acciones_masivas' },
  { label: 'Proveedores', icon: <Truck size={17} />, children: [
    { key: 'prov_listado', label: 'Listado' },
    { key: 'prov_movimientos', label: 'Movimientos Históricos' },
    { key: 'prov_documentos', label: 'Documentos' },
  ] },
  { label: 'Reportes', icon: <FileBarChart size={17} />, key: 'reportes' },
  { label: 'Noticias', icon: <Megaphone size={17} />, key: 'noticias' },
  { label: 'Consultas', icon: <ClipboardList size={17} />, key: 'consultas', porConsorcio: true },
  { label: 'Reclamos', icon: <Wrench size={17} />, key: 'reclamos', porConsorcio: true },
  { label: 'Compras', icon: <ShoppingCart size={17} />, key: 'compras', porConsorcio: true },
  { label: 'Unidades', icon: <Home size={17} />, key: 'unidades', porConsorcio: true },
  { label: 'Mantenimientos', icon: <Wrench size={17} />, key: 'mantenimientos', porConsorcio: true },
  { label: 'Trabajos en unidades', icon: <Hammer size={17} />, key: 'trabajos', porConsorcio: true },
  { label: 'Expensas', icon: <Receipt size={17} />, porConsorcio: true, children: [
    { key: 'exp_liquidaciones', label: 'Liquidaciones' },
    { key: 'exp_gastos', label: 'Gastos pendientes' },
    { key: 'exp_provisiones', label: 'Provisiones' },
    { key: 'exp_ordenes_pago', label: 'Pago a proveedores' },
    { key: 'exp_cheques', label: 'Gestión de cheques' },
    { key: 'exp_planes', label: 'Planes de pago' },
    { key: 'exp_ctacte', label: 'Cuentas corrientes' },
  ] },
  { label: 'Sueldos', icon: <WalletCards size={17} />, key: 'sueldos', porConsorcio: true },
  { label: 'Contabilidad', icon: <BarChart3 size={17} />, key: 'contabilidad', porConsorcio: true },
  { label: 'Calendario', icon: <CalendarDays size={17} />, key: 'calendario' },
  { label: 'Archivos', icon: <Archive size={17} />, key: 'archivos' },
  { label: 'Teléfonos', icon: <Phone size={17} />, key: 'telefonos' },
  { label: 'Encuestas', icon: <Vote size={17} />, key: 'encuestas', porConsorcio: true },
];

/*
  Vista agrupada (la de por defecto): misma app, menú agrupado por tarea y estética propia (barra lateral clara, cabecera blanca).
  La vista "Clásica" (NAV, arriba) replica el orden de Octavo y sólo la eligen los habilitados desde Configuración → Apariencia.
*/
const NAV_AMEL: NavEntry[] = [
  { label: 'Inicio', icon: <LayoutDashboard size={17} />, children: [
    { key: 'tablero', label: 'Tablero' },
    { key: 'calendario', label: 'Agenda' },
  ] },
  { label: 'Edificios', icon: <Building2 size={17} />, children: [
    { key: 'consorcios', label: 'Consorcios' },
    { key: 'unidades', label: 'Unidades y propietarios' },
    { key: 'archivos', label: 'Archivos' },
    { key: 'telefonos', label: 'Teléfonos útiles' },
  ] },
  { label: 'Expensas', icon: <Receipt size={17} />, porConsorcio: true, children: [
    { key: 'exp_liquidaciones', label: 'Liquidaciones' },
    { key: 'exp_gastos', label: 'Gastos pendientes' },
    { key: 'exp_provisiones', label: 'Provisiones' },
    { key: 'exp_ctacte', label: 'Cobranzas y cuentas corrientes' },
    { key: 'exp_planes', label: 'Planes de pago' },
    { key: 'acciones_masivas', label: 'Acciones masivas' },
  ] },
  { label: 'Proveedores y pagos', icon: <Truck size={17} />, children: [
    { key: 'prov_listado', label: 'Proveedores' },
    { key: 'exp_ordenes_pago', label: 'Órdenes de pago' },
    { key: 'exp_cheques', label: 'Cheques' },
    { key: 'compras', label: 'Compras y cotizaciones' },
    { key: 'prov_movimientos', label: 'Movimientos históricos' },
    { key: 'prov_documentos', label: 'Documentación' },
  ] },
  { label: 'Mantenimiento', icon: <Wrench size={17} />, porConsorcio: true, children: [
    { key: 'reclamos', label: 'Reclamos' },
    { key: 'mantenimientos', label: 'Mantenimientos' },
    { key: 'trabajos', label: 'Trabajos en unidades' },
  ] },
  { label: 'Comunicación', icon: <Megaphone size={17} />, children: [
    { key: 'noticias', label: 'Comunicados' },
    { key: 'consultas', label: 'Consultas' },
    { key: 'encuestas', label: 'Encuestas' },
    { key: 'portal', label: 'Portal de vecinos' },
    { key: 'envios_mail', label: 'Envíos de mail' },
  ] },
  { label: 'Contabilidad y sueldos', icon: <BarChart3 size={17} />, children: [
    { key: 'contabilidad', label: 'Contabilidad' },
    { key: 'sueldos', label: 'Sueldos' },
    { key: 'reportes', label: 'Reportes' },
  ] },
  { label: 'Administración', icon: <Settings size={17} />, children: [
    { key: 'config', label: 'Mi administración' },
    { key: 'usuarios', label: 'Usuarios' },
    { key: 'notificaciones', label: 'Notificaciones' },
    { key: 'mis_facturas', label: 'Mis facturas' },
    { key: 'export_datos', label: 'Exportar datos' },
  ] },
];

export const PAGE_TITLES: Record<PageKey, string> = {
  config: 'Configuración', consorcios: 'Consorcios', mis_facturas: 'Mis Facturas',
  notificaciones: 'Notificaciones', envios_mail: 'Envíos de mail', portal: 'Portal de vecinos', usuarios: 'Usuarios', export_datos: 'Export de datos',
  tablero: 'Tablero de control', acciones_masivas: 'Acciones masivas',
  prov_listado: 'Proveedores', prov_movimientos: 'Movimientos históricos', prov_documentos: 'Certificación de proveedores',
  reportes: 'Reportes', noticias: 'Noticias', consultas: 'Consultas', reclamos: 'Reclamos', compras: 'Compras',
  unidades: 'Unidades', mantenimientos: 'Mantenimientos y controles', trabajos: 'Trabajos en unidades',
  exp_liquidaciones: 'Expensas · Liquidaciones', exp_gastos: 'Gastos pendientes', exp_provisiones: 'Provisiones',
  exp_ordenes_pago: 'Pago a proveedores', exp_cheques: 'Gestión de cheques', exp_planes: 'Planes de pago',
  exp_ctacte: 'Cuentas corrientes', sueldos: 'Sueldos', contabilidad: 'Contabilidad',
  calendario: 'Calendario', archivos: 'Archivos', telefonos: 'Teléfonos', encuestas: 'Encuestas',
};

/** Páginas que trabajan sobre el consorcio seleccionado. */
export const PAGES_POR_CONSORCIO = new Set<PageKey>(
  NAV.flatMap((e) => (e.porConsorcio ? (e.children ? e.children.map((c) => c.key) : e.key ? [e.key] : []) : [])),
);

export function Layout({ page, onNavigate, children }: { page: PageKey; onNavigate: (p: PageKey) => void; children: ReactNode }) {
  const { consorcios, consorcio, setConsorcioId, usuario, email, cerrarSesion, superadmin, administraciones, administracionId, verTodo, cambiarAdministracion } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(() => NAV.filter((e) => e.children?.some((c) => c.key === page)).map((e) => e.label));

  const toggle = (label: string) =>
    setExpanded((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));

  const go = (p: PageKey) => { onNavigate(p); setSidebarOpen(false); };
  // Por defecto la vista agrupada; la clásica sólo si el usuario está habilitado y la eligió en Configuración
  const amel = !(puedeElegirVista(email, superadmin) && vistaGuardada() === 'clasica');
  const hb = amel ? 'hover:bg-slate-100' : 'hover:bg-white/15';
  const pill = amel ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-white/15 hover:bg-white/25 text-white';
  const nav = amel ? NAV_AMEL : NAV;
  // Grupo abierto automáticamente según la página activa
  const grupoActivo = nav.find((e) => e.children?.some((c) => c.key === page))?.label;

  const esPorConsorcio = PAGES_POR_CONSORCIO.has(page);

  return (
    <div className="min-h-screen bg-slate-50 flex max-w-[100vw] overflow-x-hidden">
      {/* Sidebar */}
      {sidebarOpen && <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed lg:sticky top-0 h-screen w-64 flex flex-col z-40 transition-transform overflow-y-auto ${amel ? 'bg-white text-slate-700 border-r border-slate-200' : 'bg-[#12284f] text-slate-200'} ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className={`px-5 py-4 flex items-center gap-2 ${amel ? 'border-b border-slate-100' : 'border-b border-white/10'}`}>
          <LogoMarca size={34} claro={!amel} />
          <LogoNombre claro={!amel} sub="Administración de consorcios" />
        </div>
        <nav className={`flex-1 py-3 ${amel ? 'px-3 space-y-0.5' : ''}`}>
          {nav.map((entry) => {
            const isGroup = !!entry.children;
            const active = entry.key === page || entry.children?.some((c) => c.key === page);
            if (!isGroup) {
              return (
                <button key={entry.label} onClick={() => go(entry.key!)}
                  className={amel
                    ? `w-full flex items-center gap-3 px-3 py-2 text-[13px] rounded-lg transition-colors ${active ? 'bg-teal-50 text-teal-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`
                    : `w-full flex items-center gap-3 px-5 py-2 text-[13px] transition-colors ${active ? 'bg-teal-500/15 text-white border-l-2 border-teal-400' : 'text-slate-300 hover:bg-white/5 border-l-2 border-transparent'}`}>
                  {entry.icon}<span>{entry.label}</span>
                </button>
              );
            }
            const open = expanded.includes(entry.label) || (amel && grupoActivo === entry.label);
            return (
              <div key={entry.label}>
                <button onClick={() => toggle(entry.label)}
                  className={amel
                    ? `w-full flex items-center gap-3 px-3 py-2 text-[13px] rounded-lg transition-colors ${active ? 'text-teal-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`
                    : `w-full flex items-center gap-3 px-5 py-2 text-[13px] transition-colors ${active ? 'text-white' : 'text-slate-300 hover:bg-white/5'}`}>
                  {entry.icon}<span className="flex-1 text-left">{entry.label}</span>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {open && entry.children!.map((c) => (
                  <button key={c.key} onClick={() => go(c.key)}
                    className={amel
                      ? `w-full flex items-center gap-2 pl-10 pr-3 py-1.5 text-[13px] rounded-lg transition-colors ${c.key === page ? 'bg-teal-50 text-teal-700 font-semibold' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`
                      : `w-full flex items-center gap-2 pl-12 pr-4 py-1.5 text-[13px] transition-colors ${c.key === page ? 'text-teal-300 font-medium' : 'text-slate-400 hover:text-slate-200'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className={`sticky top-0 z-20 shadow ${amel ? 'bg-white text-slate-700 border-b border-slate-200' : 'bg-gradient-to-r from-[#1b4a9e] via-[#1f6fd0] to-[#2bb8b4] text-white'}`}>
          <div className="flex items-center gap-1.5 sm:gap-3 px-3 sm:px-4 py-2.5 overflow-hidden">
            <button className={`lg:hidden p-1.5 rounded shrink-0 ${hb}`} onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            {/* Selector de consorcio activo (se achica en el celular) */}
            <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none">
              <Building2 size={16} className="opacity-80 shrink-0 hidden sm:block" />
              <select
                value={consorcio?.id || ''}
                onChange={(e) => setConsorcioId(e.target.value || null)}
                className={`text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 w-full sm:w-auto sm:max-w-[260px] min-w-0 truncate ${amel ? 'bg-slate-100 text-slate-800 border border-slate-200 focus:ring-teal-300 font-medium' : 'bg-teal-600/60 text-white border border-white/20 focus:ring-white/40'}`}>
                <option value="">— Elegir consorcio —</option>
                {consorcios.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.activo ? '' : ' (inactivo)'}</option>)}
              </select>
            </div>
            <div className="hidden sm:block flex-1" />
            <button onClick={() => go('notificaciones')} className={`p-2 rounded-full shrink-0 ${hb}`} title="Notificaciones">
              <Bell size={18} />
            </button>
            {superadmin && (
              <select value={verTodo ? '' : administracionId || ''} onChange={(e) => cambiarAdministracion(e.target.value || null)} title="Trabajar como administración"
                className={`text-xs rounded-full border-0 px-2.5 py-1.5 max-w-[90px] sm:max-w-[180px] shrink min-w-0 truncate focus:outline-none [&>option]:text-slate-800 ${pill}`}>
                <option value="">★ Todas las administraciones</option>
                {administraciones.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            )}
            <button onClick={() => go('config')} className={`p-2 rounded-full shrink-0 hidden sm:block ${hb}`} title="Configuración">
              <Settings size={18} />
            </button>
            <button onClick={() => go('usuarios')} className={`hidden sm:flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full text-sm shrink-0 ${pill}`} title="Usuarios">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center ${amel ? 'bg-teal-500 text-white' : 'bg-white/25'}`}><Users size={13} /></span>
              <span className="hidden sm:inline max-w-[140px] truncate">{usuario}</span>
            </button>
            <button onClick={cerrarSesion} className={`p-2 rounded-full shrink-0 ${hb}`} title="Cerrar sesión"><LogOut size={18} /></button>
          </div>
        </header>

        {/* Breadcrumb */}
        <div className="px-6 pt-4 text-[12px] uppercase tracking-wide text-slate-400 flex items-center gap-1.5 flex-wrap">
          <span className={`font-medium ${amel ? 'text-teal-600' : 'text-teal-600'}`}>Inicio</span>
          {esPorConsorcio && consorcio && (<><span>/</span><span className="text-teal-600 font-medium">{consorcio.nombre}</span></>)}
          <span>/</span>
          <span className="text-slate-500 font-medium">{PAGE_TITLES[page]}</span>
        </div>

        <main className="flex-1 px-3 sm:px-6 py-4 min-w-0">
          {esPorConsorcio && !consorcio ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Building2 size={40} className="text-slate-300 mb-3" />
              <p className="text-slate-600 font-medium">Elegí un consorcio para trabajar en este módulo</p>
              <p className="text-slate-400 text-sm mt-1">Usá el selector de la barra superior, o creá uno en Mi Administración → Consorcios.</p>
            </div>
          ) : children}
        </main>
      </div>
    </div>
  );
}

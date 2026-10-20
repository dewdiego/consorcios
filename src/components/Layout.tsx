import { type ReactNode, useState } from 'react';
import {
  Archive, BarChart3, Bell, Building2, CalendarDays, ChevronDown, ChevronRight, ClipboardList,
  FileBarChart, LayoutDashboard, Megaphone, Menu, Home, Phone, Receipt, Settings, ShoppingCart,
  Truck, Users, Vote, WalletCards, Wrench, Zap,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';

export type PageKey =
  | 'config' | 'consorcios' | 'mis_facturas' | 'notificaciones' | 'usuarios' | 'export_datos'
  | 'tablero'
  | 'acciones_masivas'
  | 'prov_listado' | 'prov_movimientos' | 'prov_documentos'
  | 'reportes'
  | 'noticias'
  | 'consultas'
  | 'reclamos'
  | 'compras'
  | 'unidades'
  | 'mantenimientos'
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

export const PAGE_TITLES: Record<PageKey, string> = {
  config: 'Configuración', consorcios: 'Consorcios', mis_facturas: 'Mis Facturas',
  notificaciones: 'Notificaciones', usuarios: 'Usuarios', export_datos: 'Export de datos',
  tablero: 'Tablero de control', acciones_masivas: 'Acciones masivas',
  prov_listado: 'Proveedores', prov_movimientos: 'Movimientos históricos', prov_documentos: 'Certificación de proveedores',
  reportes: 'Reportes', noticias: 'Noticias', consultas: 'Consultas', reclamos: 'Reclamos', compras: 'Compras',
  unidades: 'Unidades', mantenimientos: 'Mantenimientos y controles',
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
  const { consorcios, consorcio, setConsorcioId } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(() => NAV.filter((e) => e.children?.some((c) => c.key === page)).map((e) => e.label));

  const toggle = (label: string) =>
    setExpanded((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));

  const go = (p: PageKey) => { onNavigate(p); setSidebarOpen(false); };

  const esPorConsorcio = PAGES_POR_CONSORCIO.has(page);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      {sidebarOpen && <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed lg:sticky top-0 h-screen w-64 bg-[#1e2a4a] text-slate-200 flex flex-col z-40 transition-transform overflow-y-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="px-5 py-4 flex items-center gap-2 border-b border-white/10">
          <Building2 size={22} className="text-teal-400" />
          <div>
            <p className="font-bold text-white leading-tight">Consorcios</p>
            <p className="text-[11px] text-slate-400">Panel de administración</p>
          </div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map((entry) => {
            const isGroup = !!entry.children;
            const active = entry.key === page || entry.children?.some((c) => c.key === page);
            if (!isGroup) {
              return (
                <button key={entry.label} onClick={() => go(entry.key!)}
                  className={`w-full flex items-center gap-3 px-5 py-2 text-[13px] transition-colors ${active ? 'bg-teal-500/15 text-white border-l-2 border-teal-400' : 'text-slate-300 hover:bg-white/5 border-l-2 border-transparent'}`}>
                  {entry.icon}<span>{entry.label}</span>
                </button>
              );
            }
            const open = expanded.includes(entry.label);
            return (
              <div key={entry.label}>
                <button onClick={() => toggle(entry.label)}
                  className={`w-full flex items-center gap-3 px-5 py-2 text-[13px] transition-colors ${active ? 'text-white' : 'text-slate-300 hover:bg-white/5'}`}>
                  {entry.icon}<span className="flex-1 text-left">{entry.label}</span>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {open && entry.children!.map((c) => (
                  <button key={c.key} onClick={() => go(c.key)}
                    className={`w-full flex items-center gap-2 pl-12 pr-4 py-1.5 text-[13px] transition-colors ${c.key === page ? 'text-teal-300 font-medium' : 'text-slate-400 hover:text-slate-200'}`}>
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
        <header className="sticky top-0 z-20 bg-teal-500 text-white shadow">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button className="lg:hidden p-1.5 rounded hover:bg-white/15" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            {/* Selector de consorcio activo */}
            <div className="flex items-center gap-2">
              <Building2 size={16} className="opacity-80" />
              <select
                value={consorcio?.id || ''}
                onChange={(e) => setConsorcioId(e.target.value || null)}
                className="bg-teal-600/60 text-white text-sm rounded-lg px-3 py-1.5 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 max-w-[260px]">
                <option value="">— Elegir consorcio —</option>
                {consorcios.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.activo ? '' : ' (inactivo)'}</option>)}
              </select>
            </div>
            <div className="flex-1" />
            <button onClick={() => go('notificaciones')} className="p-2 rounded-full hover:bg-white/15" title="Notificaciones">
              <Bell size={18} />
            </button>
            <button onClick={() => go('config')} className="p-2 rounded-full hover:bg-white/15" title="Configuración">
              <Settings size={18} />
            </button>
            <button onClick={() => go('usuarios')} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-semibold" title="Usuarios">
              <Users size={15} />
            </button>
          </div>
        </header>

        {/* Breadcrumb */}
        <div className="px-6 pt-4 text-[12px] uppercase tracking-wide text-slate-400 flex items-center gap-1.5 flex-wrap">
          <span className="text-teal-600 font-medium">Inicio</span>
          {esPorConsorcio && consorcio && (<><span>/</span><span className="text-teal-600 font-medium">{consorcio.nombre}</span></>)}
          <span>/</span>
          <span className="text-slate-500 font-medium">{PAGE_TITLES[page]}</span>
        </div>

        <main className="flex-1 px-6 py-4">
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

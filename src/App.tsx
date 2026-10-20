import { useState } from 'react';
import { AppProvider } from '@/context/AppContext';
import { Layout, type PageKey } from '@/components/Layout';
import { Tablero } from '@/pages/Tablero';
import { Configuracion } from '@/pages/Configuracion';
import { Consorcios } from '@/pages/Consorcios';
import { MisFacturas } from '@/pages/MisFacturas';
import { Notificaciones } from '@/pages/Notificaciones';
import { Usuarios } from '@/pages/Usuarios';
import { ExportDatos } from '@/pages/ExportDatos';
import { AccionesMasivas } from '@/pages/AccionesMasivas';
import { Proveedores } from '@/pages/Proveedores';
import { Reportes } from '@/pages/Reportes';
import { Noticias } from '@/pages/Noticias';
import { Consultas } from '@/pages/Consultas';
import { Reclamos } from '@/pages/Reclamos';
import { Compras } from '@/pages/Compras';
import { Unidades } from '@/pages/Unidades';
import { Mantenimientos } from '@/pages/Mantenimientos';
import { Liquidaciones } from '@/pages/Liquidaciones';
import { GastosPendientes } from '@/pages/GastosPendientes';
import { Provisiones } from '@/pages/Provisiones';
import { OrdenesPago } from '@/pages/OrdenesPago';
import { Cheques } from '@/pages/Cheques';
import { PlanesPago } from '@/pages/PlanesPago';
import { CuentasCorrientes } from '@/pages/CuentasCorrientes';
import { Sueldos } from '@/pages/Sueldos';
import { Contabilidad } from '@/pages/Contabilidad';
import { Calendario } from '@/pages/Calendario';
import { Archivos } from '@/pages/Archivos';
import { Telefonos } from '@/pages/Telefonos';
import { Encuestas } from '@/pages/Encuestas';

function Pages({ page, onNavigate }: { page: PageKey; onNavigate: (p: PageKey) => void }) {
  switch (page) {
    case 'tablero': return <Tablero />;
    case 'config': return <Configuracion />;
    case 'consorcios': return <Consorcios onNavigate={onNavigate} />;
    case 'mis_facturas': return <MisFacturas />;
    case 'notificaciones': return <Notificaciones />;
    case 'usuarios': return <Usuarios />;
    case 'export_datos': return <ExportDatos />;
    case 'acciones_masivas': return <AccionesMasivas />;
    case 'prov_listado': return <Proveedores tab="listado" />;
    case 'prov_movimientos': return <Proveedores tab="movimientos" />;
    case 'prov_documentos': return <Proveedores tab="documentos" />;
    case 'reportes': return <Reportes />;
    case 'noticias': return <Noticias />;
    case 'consultas': return <Consultas />;
    case 'reclamos': return <Reclamos />;
    case 'compras': return <Compras />;
    case 'unidades': return <Unidades />;
    case 'mantenimientos': return <Mantenimientos />;
    case 'exp_liquidaciones': return <Liquidaciones />;
    case 'exp_gastos': return <GastosPendientes />;
    case 'exp_provisiones': return <Provisiones />;
    case 'exp_ordenes_pago': return <OrdenesPago />;
    case 'exp_cheques': return <Cheques />;
    case 'exp_planes': return <PlanesPago />;
    case 'exp_ctacte': return <CuentasCorrientes />;
    case 'sueldos': return <Sueldos />;
    case 'contabilidad': return <Contabilidad />;
    case 'calendario': return <Calendario />;
    case 'archivos': return <Archivos />;
    case 'telefonos': return <Telefonos />;
    case 'encuestas': return <Encuestas />;
  }
}

export default function App() {
  const [page, setPage] = useState<PageKey>('tablero');
  return (
    <AppProvider>
      <Layout page={page} onNavigate={setPage}>
        <Pages page={page} onNavigate={setPage} />
      </Layout>
    </AppProvider>
  );
}

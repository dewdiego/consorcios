import { useState } from 'react';
import { Database, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, PageHeader } from '@/components/ui';
import { exportCSV } from '@/lib/engine';

const TABLAS: { tabla: string; label: string; desc: string }[] = [
  { tabla: 'consorcios', label: 'Consorcios', desc: 'Edificios y su configuración de liquidación' },
  { tabla: 'unidades', label: 'Unidades', desc: 'UF, propietarios y coeficientes' },
  { tabla: 'gastos', label: 'Gastos', desc: 'Todos los gastos cargados' },
  { tabla: 'liquidaciones', label: 'Liquidaciones', desc: 'Períodos liquidados' },
  { tabla: 'cupones', label: 'Cupones', desc: 'Expensas por UF y período' },
  { tabla: 'pagos', label: 'Pagos', desc: 'Cobranzas registradas' },
  { tabla: 'ordenes_pago', label: 'Órdenes de pago', desc: 'Pagos a proveedores' },
  { tabla: 'proveedores', label: 'Proveedores', desc: 'Padrón de proveedores' },
  { tabla: 'reclamos', label: 'Reclamos', desc: 'Reclamos y su estado' },
  { tabla: 'movimientos', label: 'Movimientos de caja', desc: 'Ingresos y egresos' },
  { tabla: 'empleados', label: 'Empleados', desc: 'Personal de los edificios' },
  { tabla: 'sueldo_liquidaciones', label: 'Sueldos', desc: 'Recibos liquidados' },
];

export function ExportDatos() {
  const [busy, setBusy] = useState('');

  const exportar = async (tabla: string) => {
    setBusy(tabla);
    const { data } = await supabase.from(tabla).select('*').limit(10000);
    const rows = (data as Record<string, unknown>[]) || [];
    if (rows.length === 0) { alert('La tabla está vacía.'); setBusy(''); return; }
    const headers = Object.keys(rows[0]);
    exportCSV(`${tabla}.csv`, headers, rows.map((r) => headers.map((h) => {
      const v = r[h];
      return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    })));
    setBusy('');
  };

  return (
    <div>
      <PageHeader title="Export de datos" subtitle="Descargá cualquier tabla en CSV (separador ; compatible con Excel)" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TABLAS.map((t) => (
          <Card key={t.tabla} className="p-4 flex items-center gap-3">
            <Database size={18} className="text-slate-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700">{t.label}</p>
              <p className="text-xs text-slate-400 truncate">{t.desc}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => exportar(t.tabla)} disabled={busy === t.tabla}>
              <Download size={13} /> CSV
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

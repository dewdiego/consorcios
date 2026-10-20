import { useEffect, useState } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { supabase, type Gasto, type Rubro, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, Input, PageHeader, Select, Spinner, Table, Td, Tabs } from '@/components/ui';
import { exportCSV, fmtMoney, periodoActual, round2, saldosPorUnidad } from '@/lib/engine';

export function Reportes() {
  const { consorcios } = useApp();
  const [tab, setTab] = useState('deudores');
  const [consorcioId, setConsorcioId] = useState('');
  const [periodo, setPeriodo] = useState(periodoActual());
  const [loading, setLoading] = useState(false);

  const [deudores, setDeudores] = useState<{ consorcio: string; unidad: Unidad; saldo: number }[]>([]);
  const [gastosRubro, setGastosRubro] = useState<{ rubro: string; total: number; cantidad: number }[]>([]);
  const [cobranza, setCobranza] = useState<{ consorcio: string; periodo: string; distribuido: number; cobrado: number }[]>([]);

  const cargarDeudores = async () => {
    setLoading(true);
    const out: { consorcio: string; unidad: Unidad; saldo: number }[] = [];
    const lista = consorcios.filter((c) => !consorcioId || c.id === consorcioId);
    for (const c of lista) {
      const [saldos, { data: us }] = await Promise.all([
        saldosPorUnidad(c.id),
        supabase.from('unidades').select('*').eq('consorcio_id', c.id),
      ]);
      for (const u of (us as Unidad[]) || []) {
        const s = saldos.get(u.id)?.saldo || 0;
        if (s > 1) out.push({ consorcio: c.nombre, unidad: u, saldo: s });
      }
    }
    out.sort((a, b) => b.saldo - a.saldo);
    setDeudores(out);
    setLoading(false);
  };

  const cargarGastos = async () => {
    setLoading(true);
    let q = supabase.from('gastos').select('*, rubros(*), liquidaciones!inner(periodo)').eq('liquidaciones.periodo', periodo);
    if (consorcioId) q = q.eq('consorcio_id', consorcioId);
    const { data } = await q;
    const map: Record<string, { total: number; cantidad: number }> = {};
    for (const g of (data as (Gasto & { rubros: Rubro | null })[]) || []) {
      const nombre = g.rubros?.nombre || 'Sin rubro';
      map[nombre] = { total: (map[nombre]?.total || 0) + Number(g.monto), cantidad: (map[nombre]?.cantidad || 0) + 1 };
    }
    setGastosRubro(Object.entries(map).map(([rubro, v]) => ({ rubro, ...v })).sort((a, b) => b.total - a.total));
    setLoading(false);
  };

  const cargarCobranza = async () => {
    setLoading(true);
    let q = supabase.from('liquidaciones').select('*, consorcios(nombre)').neq('estado', 'abierta').order('periodo', { ascending: false }).limit(60);
    if (consorcioId) q = q.eq('consorcio_id', consorcioId);
    const { data: ls } = await q;
    const ids = (ls || []).map((l) => l.id);
    const cobradoMap: Record<string, number> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from('pagos').select('monto, cupones!inner(liquidacion_id)').not('cupon_id', 'is', null);
      for (const p of ((ps || []) as unknown as { monto: number; cupones: { liquidacion_id: string } }[])) {
        if (!ids.includes(p.cupones.liquidacion_id)) continue;
        cobradoMap[p.cupones.liquidacion_id] = (cobradoMap[p.cupones.liquidacion_id] || 0) + Number(p.monto);
      }
    }
    setCobranza((ls || []).map((l) => ({
      consorcio: (l.consorcios as { nombre?: string } | null)?.nombre || '—', periodo: l.periodo,
      distribuido: Number(l.total_distribuido), cobrado: cobradoMap[l.id] || 0,
    })));
    setLoading(false);
  };

  useEffect(() => {
    if (tab === 'deudores') cargarDeudores();
    else if (tab === 'gastos') cargarGastos();
    else cargarCobranza();
  }, [tab, consorcioId, periodo, consorcios.length]);

  const totalDeuda = round2(deudores.reduce((a, d) => a + d.saldo, 0));
  const totalGastos = round2(gastosRubro.reduce((a, g) => a + g.total, 0));

  return (
    <div>
      <PageHeader title="Reportes" subtitle="Deudores, gastos por rubro y evolución de cobranza"
        action={<Button variant="secondary" onClick={() => {
          if (tab === 'deudores') exportCSV('deudores.csv', ['Consorcio', 'UF', 'Depto', 'Propietario', 'Saldo'], deudores.map((d) => [d.consorcio, d.unidad.uf, d.unidad.depto, d.unidad.propietario, d.saldo]));
          else if (tab === 'gastos') exportCSV(`gastos_${periodo}.csv`, ['Rubro', 'Cantidad', 'Total'], gastosRubro.map((g) => [g.rubro, g.cantidad, g.total]));
          else exportCSV('cobranza.csv', ['Consorcio', 'Período', 'Distribuido', 'Cobrado', '%'], cobranza.map((c) => [c.consorcio, c.periodo, c.distribuido, c.cobrado, c.distribuido > 0 ? Math.round((c.cobrado / c.distribuido) * 100) : 0]));
        }}><Download size={15} /> Exportar</Button>} />

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="w-60"><Select label="Consorcio" value={consorcioId} onChange={setConsorcioId} placeholder="Todos"
            options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} /></div>
          {tab === 'gastos' && <div className="w-40"><Input label="Período" type="month" value={periodo} onChange={setPeriodo} /></div>}
        </div>
      </Card>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'deudores', label: 'Deudores' },
        { key: 'gastos', label: 'Gastos por rubro' },
        { key: 'cobranza', label: 'Cobranza por período' },
      ]} />

      {loading ? <Spinner /> : tab === 'deudores' ? (
        <Card>
          <div className="px-4 pt-4 text-sm text-slate-500">Deuda total: <b className="text-red-500">{fmtMoney(totalDeuda)}</b> · {deudores.length} unidades con deuda</div>
          <Table headers={['Consorcio', 'UF', 'Depto', 'Propietario', 'Teléfono', 'Saldo deudor']}>
            {deudores.map((d, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <Td>{d.consorcio}</Td>
                <Td className="font-mono text-xs">{String(d.unidad.uf).padStart(3, '0')}</Td>
                <Td className="font-medium">{d.unidad.depto}</Td>
                <Td>{d.unidad.propietario || '—'}</Td>
                <Td className="text-slate-500">{d.unidad.propietario_telefono || '—'}</Td>
                <Td><Badge color="red">{fmtMoney(d.saldo)}</Badge></Td>
              </tr>
            ))}
            {deudores.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-400 py-10"><FileBarChart size={24} className="mx-auto mb-2 text-slate-300" />No hay deudores. 🎉</Td></tr>}
          </Table>
        </Card>
      ) : tab === 'gastos' ? (
        <Card>
          <div className="px-4 pt-4 text-sm text-slate-500">Total {periodo}: <b>{fmtMoney(totalGastos)}</b></div>
          <Table headers={['Rubro', 'Cantidad', 'Total', '% del total']}>
            {gastosRubro.map((g) => (
              <tr key={g.rubro} className="hover:bg-slate-50">
                <Td className="font-medium">{g.rubro}</Td>
                <Td>{g.cantidad}</Td>
                <Td className="font-semibold">{fmtMoney(g.total)}</Td>
                <Td>
                  <div className="flex items-center gap-2 min-w-[140px]">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500" style={{ width: `${totalGastos > 0 ? (g.total / totalGastos) * 100 : 0}%` }} /></div>
                    <span className="text-xs text-slate-500 w-10">{totalGastos > 0 ? Math.round((g.total / totalGastos) * 100) : 0}%</span>
                  </div>
                </Td>
              </tr>
            ))}
            {gastosRubro.length === 0 && <tr><Td colSpan={4} className="text-center text-slate-400 py-10">Sin gastos vinculados a liquidaciones de {periodo}</Td></tr>}
          </Table>
        </Card>
      ) : (
        <Card>
          <Table headers={['Consorcio', 'Período', 'Distribuido', 'Cobrado', 'Cumplimiento']}>
            {cobranza.map((c, i) => {
              const pct = c.distribuido > 0 ? Math.min(100, (c.cobrado / c.distribuido) * 100) : 0;
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <Td className="font-medium">{c.consorcio}</Td>
                  <Td>{c.periodo}</Td>
                  <Td>{fmtMoney(c.distribuido)}</Td>
                  <Td className="text-emerald-600">{fmtMoney(c.cobrado)}</Td>
                  <Td>
                    <div className="flex items-center gap-2 min-w-[140px]">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500" style={{ width: `${pct}%` }} /></div>
                      <span className="text-xs text-slate-500 w-10">{Math.round(pct)}%</span>
                    </div>
                  </Td>
                </tr>
              );
            })}
            {cobranza.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-400 py-10">Sin liquidaciones cerradas</Td></tr>}
          </Table>
        </Card>
      )}
    </div>
  );
}

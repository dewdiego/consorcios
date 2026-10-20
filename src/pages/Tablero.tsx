import { useEffect, useState } from 'react';
import { supabase, type Consorcio, type Liquidacion } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Card, Input, PageHeader, Spinner, StatCircle } from '@/components/ui';
import { fmtMoney, periodoActual } from '@/lib/engine';

type FilaUF = { nombre: string; cupones: number; distribuido: number; cobrado: number };

export function Tablero() {
  const { consorcios } = useApp();
  const [periodo, setPeriodo] = useState(periodoActual());
  const [loading, setLoading] = useState(true);
  const [liqs, setLiqs] = useState<Liquidacion[]>([]);
  const [filas, setFilas] = useState<FilaUF[]>([]);
  const [gastosNoVinculados, setGastosNoVinculados] = useState<{ nombre: string; total: number }[]>([]);
  const [sueldosPct, setSueldosPct] = useState(0);

  const activos = consorcios.filter((c) => c.activo);

  const load = async () => {
    setLoading(true);
    const [{ data: ls }, { data: pend }, { data: emps }, { data: sueldos }] = await Promise.all([
      supabase.from('liquidaciones').select('*').eq('periodo', periodo),
      supabase.from('gastos').select('consorcio_id, monto').is('liquidacion_id', null),
      supabase.from('empleados').select('id, consorcio_id').eq('activo', true),
      supabase.from('sueldo_liquidaciones').select('empleado_id').eq('periodo', periodo),
    ]);
    const liqList = (ls as Liquidacion[]) || [];
    setLiqs(liqList);

    // cupones y cobranza por consorcio para el período
    const ids = liqList.map((l) => l.id);
    let cupCount: Record<string, number> = {};
    let cobrado: Record<string, number> = {};
    if (ids.length) {
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase.from('cupones').select('liquidacion_id').in('liquidacion_id', ids),
        supabase.from('pagos').select('monto, cupones!inner(liquidacion_id)').not('cupon_id', 'is', null),
      ]);
      cupCount = {};
      for (const c of (cs as { liquidacion_id: string }[]) || []) cupCount[c.liquidacion_id] = (cupCount[c.liquidacion_id] || 0) + 1;
      cobrado = {};
      for (const p of ((ps || []) as unknown as { monto: number; cupones: { liquidacion_id: string } }[])) {
        if (!ids.includes(p.cupones.liquidacion_id)) continue;
        cobrado[p.cupones.liquidacion_id] = (cobrado[p.cupones.liquidacion_id] || 0) + Number(p.monto);
      }
    }
    setFilas(liqList.map((l) => ({
      nombre: consorcios.find((c) => c.id === l.consorcio_id)?.nombre || '—',
      cupones: cupCount[l.id] || 0,
      distribuido: Number(l.total_distribuido),
      cobrado: cobrado[l.id] || 0,
    })));

    // gastos no vinculados por consorcio
    const mapPend: Record<string, number> = {};
    for (const g of (pend as { consorcio_id: string; monto: number }[]) || []) mapPend[g.consorcio_id] = (mapPend[g.consorcio_id] || 0) + Number(g.monto);
    setGastosNoVinculados(Object.entries(mapPend).map(([cid, total]) => ({
      nombre: consorcios.find((c) => c.id === cid)?.nombre || '—', total,
    })).sort((a, b) => b.total - a.total));

    // sueldos liquidados
    const totalEmp = (emps || []).length;
    const liquidados = new Set(((sueldos || []) as { empleado_id: string }[]).map((s) => s.empleado_id)).size;
    setSueldosPct(totalEmp > 0 ? (liquidados / totalEmp) * 100 : 0);

    setLoading(false);
  };
  useEffect(() => { load(); }, [periodo, consorcios.length]);

  const enviadas = liqs.filter((l) => l.estado === 'enviada').length;
  const cerradas = liqs.filter((l) => l.estado !== 'abierta').length;
  const totalDistribuido = filas.reduce((a, f) => a + f.distribuido, 0);
  const totalCobrado = filas.reduce((a, f) => a + f.cobrado, 0);
  const maxBar = Math.max(1, ...filas.map((f) => f.distribuido));
  const maxPend = Math.max(1, ...gastosNoVinculados.map((g) => g.total));

  return (
    <div>
      <PageHeader title="Tablero de control" subtitle="Estado global de la administración"
        action={<div className="w-40"><Input label="Período" type="month" value={periodo} onChange={setPeriodo} /></div>} />

      {loading ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card className="p-5 flex justify-center">
              <StatCircle pct={activos.length ? (enviadas / activos.length) * 100 : 0} label="Envío de expensas"
                sub={`${enviadas} de ${activos.length} consorcios enviaron ${periodo}`} />
            </Card>
            <Card className="p-5 flex justify-center">
              <StatCircle pct={activos.length ? (cerradas / activos.length) * 100 : 0} label="Períodos cerrados"
                sub={`${cerradas} de ${activos.length} liquidaciones cerradas`} />
            </Card>
            <Card className="p-5 flex justify-center">
              <StatCircle pct={totalDistribuido > 0 ? (totalCobrado / totalDistribuido) * 100 : 0} label="Recaudación global"
                sub={`${fmtMoney(totalCobrado)} de ${fmtMoney(totalDistribuido)}`} />
            </Card>
            <Card className="p-5 flex justify-center">
              <StatCircle pct={sueldosPct} label="Salarios liquidados" sub={`Período ${periodo}`} />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Card className="p-5">
              <p className="text-sm font-semibold text-teal-600 mb-1">UFs liquidadas</p>
              <p className="text-xs text-slate-400 mb-4">Distribución y cobranza por consorcio en {periodo}</p>
              {filas.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">Sin liquidaciones en este período</p> : (
                <div className="space-y-3">
                  {filas.map((f) => (
                    <div key={f.nombre}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-600">{f.nombre} <span className="text-slate-400">({f.cupones} UF)</span></span>
                        <span className="text-slate-500">{fmtMoney(f.cobrado)} / {fmtMoney(f.distribuido)}</span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden relative">
                        <div className="absolute inset-y-0 left-0 bg-blue-200 rounded-full" style={{ width: `${(f.distribuido / maxBar) * 100}%` }} />
                        <div className="absolute inset-y-0 left-0 bg-teal-500 rounded-full" style={{ width: `${(f.cobrado / maxBar) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-5">
              <p className="text-sm font-semibold text-teal-600 mb-1">Edificios administrados</p>
              <p className="text-xs text-slate-400 mb-4">{activos.length} activos · {consorcios.length - activos.length} inactivos</p>
              <div className="grid grid-cols-2 gap-3">
                {consorcios.map((c: Consorcio) => (
                  <div key={c.id} className={`rounded-lg border px-3 py-2.5 text-sm ${c.activo ? 'border-teal-200 bg-teal-50/40' : 'border-slate-200 bg-slate-50 opacity-60'}`}>
                    <p className="font-medium text-slate-700 truncate">{c.nombre}</p>
                    <p className="text-xs text-slate-400">{liqs.some((l) => l.consorcio_id === c.id) ? `Liquidación ${periodo}: ${liqs.find((l) => l.consorcio_id === c.id)?.estado}` : `Sin liquidación en ${periodo}`}</p>
                  </div>
                ))}
                {consorcios.length === 0 && <p className="text-sm text-slate-400 col-span-2">Sin consorcios cargados.</p>}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <p className="text-sm font-semibold text-teal-600 mb-1">Gastos que aún no están vinculados</p>
            <p className="text-xs text-slate-400 mb-4">Gastos cargados sin liquidación asignada: no entran en ninguna expensa hasta que los vincules</p>
            {gastosNoVinculados.length === 0 ? <p className="text-sm text-slate-400 py-4 text-center">No hay gastos sin vincular. 👌</p> : (
              <div className="space-y-3">
                {gastosNoVinculados.map((g) => (
                  <div key={g.nombre}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-600">{g.nombre}</span>
                      <span className="text-slate-500">{fmtMoney(g.total)}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full" style={{ width: `${(g.total / maxPend) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

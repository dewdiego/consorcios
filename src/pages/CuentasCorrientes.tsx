import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Users, Wallet } from 'lucide-react';
import { supabase, type Cupon, type Pago, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { exportCSV, fmtDate, fmtMoney, periodoLabel, round2, saldosPorUnidad, type SaldoUnidad } from '@/lib/engine';

/** Cuenta corriente por unidad: deuda generada por cupones vs pagos registrados. */
export function CuentasCorrientes() {
  const { consorcio } = useApp();
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [saldos, setSaldos] = useState<Map<string, SaldoUnidad>>(new Map());
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState<Unidad | null>(null);
  const [soloDeudores, setSoloDeudores] = useState(false);

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [{ data: us }, ss] = await Promise.all([
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).order('uf'),
      saldosPorUnidad(consorcio.id),
    ]);
    setUnidades((us as Unidad[]) || []);
    setSaldos(ss);
    setLoading(false);
  };
  useEffect(() => { setDetalle(null); load(); }, [consorcio?.id]);

  if (!consorcio) return null;
  if (detalle) return <CtaCteDetalle unidad={detalle} onBack={() => { setDetalle(null); load(); }} />;

  const filas = unidades
    .map((u) => ({ u, s: saldos.get(u.id) || { unidad_id: u.id, totalCupones: 0, totalPagado: 0, saldo: 0 } }))
    .filter((f) => !soloDeudores || f.s.saldo > 1);
  const deudaTotal = filas.reduce((a, f) => a + Math.max(0, f.s.saldo), 0);
  const aFavorTotal = filas.reduce((a, f) => a + Math.max(0, -f.s.saldo), 0);

  return (
    <div>
      <PageHeader title={`Cuentas corrientes · ${consorcio.nombre}`}
        subtitle={`Deuda total: ${fmtMoney(deudaTotal)} · Saldos a favor: ${fmtMoney(aFavorTotal)}`}
        action={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => exportCSV(`ctacte_${consorcio.nombre}.csv`,
            ['UF', 'Depto', 'Propietario', 'Facturado', 'Pagado', 'Saldo'],
            filas.map(({ u, s }) => [u.uf, u.depto, u.propietario, s.totalCupones, s.totalPagado, s.saldo]))}>
            <Download size={15} /> Exportar
          </Button>
        </div>} />

      <label className="flex items-center gap-2 text-sm text-slate-600 mb-4">
        <input type="checkbox" className="rounded" checked={soloDeudores} onChange={(e) => setSoloDeudores(e.target.checked)} />
        Mostrar sólo deudores
      </label>

      {loading ? <Spinner /> : unidades.length === 0 ? (
        <Card><EmptyState icon={<Users size={28} />} title="Sin unidades" subtitle="Cargá las unidades del consorcio primero." /></Card>
      ) : (
        <Card>
          <Table headers={['UF', 'Depto.', 'Propietario', 'Facturado (cupones)', 'Pagado', 'Saldo', '']}>
            {filas.map(({ u, s }) => (
              <tr key={u.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetalle(u)}>
                <Td className="font-mono text-xs">{String(u.uf).padStart(3, '0')}</Td>
                <Td className="font-medium">{u.depto}</Td>
                <Td>{u.propietario || '—'}</Td>
                <Td>{fmtMoney(s.totalCupones)}</Td>
                <Td className="text-emerald-600">{fmtMoney(s.totalPagado)}</Td>
                <Td>
                  {s.saldo > 1 ? <Badge color="red">Debe {fmtMoney(s.saldo)}</Badge>
                    : s.saldo < -1 ? <Badge color="green">A favor {fmtMoney(-s.saldo)}</Badge>
                    : <Badge color="slate">Al día</Badge>}
                </Td>
                <Td><span className="text-teal-600 text-xs font-medium">Ver movimientos →</span></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function CtaCteDetalle({ unidad, onBack }: { unidad: Unidad; onBack: () => void }) {
  const { consorcio } = useApp();
  const [cupones, setCupones] = useState<Cupon[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase.from('cupones').select('*, liquidaciones!inner(periodo, estado, fecha_vencimiento_1)').eq('unidad_id', unidad.id),
        supabase.from('pagos').select('*').eq('unidad_id', unidad.id),
      ]);
      setCupones(((cs as Cupon[]) || []).filter((c) => (c.liquidaciones as unknown as { estado: string })?.estado !== 'abierta'));
      setPagos((ps as Pago[]) || []);
      setLoading(false);
    })();
  }, [unidad.id]);

  // Línea de tiempo: débitos (cupones) y créditos (pagos)
  type Mov = { fecha: string; detalle: string; debe: number; haber: number };
  const movs: Mov[] = [
    ...cupones.map((c) => ({
      fecha: (c.liquidaciones as unknown as { fecha_vencimiento_1?: string })?.fecha_vencimiento_1 || c.created_at.slice(0, 10),
      detalle: `Expensas ${periodoLabel((c.liquidaciones as unknown as { periodo: string }).periodo)}${Number(c.intereses) > 0 ? ' (incluye intereses)' : ''}`,
      debe: Number(c.total), haber: 0,
    })),
    ...pagos.map((p) => ({ fecha: p.fecha, detalle: `Pago ${p.metodo}${p.comprobante ? ` · ${p.comprobante}` : ''}`, debe: 0, haber: Number(p.monto) })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));

  let acum = 0;
  const conSaldo = movs.map((m) => { acum = round2(acum + m.debe - m.haber); return { ...m, saldo: acum }; });
  const saldoFinal = conSaldo.length ? conSaldo[conSaldo.length - 1].saldo : 0;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-teal-600 font-medium mb-3 hover:underline"><ArrowLeft size={15} /> Volver a cuentas corrientes</button>
      <PageHeader title={`Cta. cte. UF ${unidad.uf} · ${unidad.depto}`}
        subtitle={`${unidad.propietario || 'Sin propietario'} · ${consorcio?.nombre}`}
        action={
          saldoFinal > 1 ? <Badge color="red">Saldo deudor: {fmtMoney(saldoFinal)}</Badge>
            : saldoFinal < -1 ? <Badge color="green">Saldo a favor: {fmtMoney(-saldoFinal)}</Badge>
            : <Badge color="slate">Al día</Badge>
        } />

      {loading ? <Spinner /> : conSaldo.length === 0 ? (
        <Card><EmptyState icon={<Wallet size={28} />} title="Sin movimientos" subtitle="Los cupones aparecen al cerrar cada liquidación." /></Card>
      ) : (
        <Card>
          <Table headers={['Fecha', 'Detalle', 'Debe', 'Haber', 'Saldo']}>
            {conSaldo.map((m, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <Td>{fmtDate(m.fecha)}</Td>
                <Td className="font-medium">{m.detalle}</Td>
                <Td className="text-red-500">{m.debe ? fmtMoney(m.debe) : ''}</Td>
                <Td className="text-emerald-600">{m.haber ? fmtMoney(m.haber) : ''}</Td>
                <Td className={`font-semibold ${m.saldo > 1 ? 'text-red-500' : m.saldo < -1 ? 'text-emerald-600' : 'text-slate-500'}`}>{fmtMoney(m.saldo)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

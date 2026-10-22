import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Zap } from 'lucide-react';
import { supabase, type Consorcio, type Liquidacion, type Mantenimiento, type Proveedor } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, Input, PageHeader, Select, Spinner, Table, Td, Tabs } from '@/components/ui';
import { fmtDate, fmtMoney, hoyISO, periodoActual, periodoSiguiente } from '@/lib/engine';
import { estadoMnt } from '@/pages/Mantenimientos';

/** Vista cruzada de TODOS los consorcios: vencimientos de mantenimientos y estado de liquidaciones. */
export function AccionesMasivas() {
  const { consorcios } = useApp();
  const [tab, setTab] = useState('mantenimientos');
  const [mnts, setMnts] = useState<Mantenimiento[]>([]);
  const [liqs, setLiqs] = useState<Liquidacion[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const hoy = hoyISO();
  const [fConsorcio, setFConsorcio] = useState('');
  const [fDesde, setFDesde] = useState(hoy.slice(0, 8) + '01');
  const [fHasta, setFHasta] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10));
  const [fProveedor, setFProveedor] = useState('');

  const load = async () => {
    setLoading(true);
    const [m, l, p] = await Promise.all([
      supabase.from('mantenimientos').select('*, mantenimiento_tipos(*), proveedores(*), consorcios(*)').order('vencimiento'),
      supabase.from('liquidaciones').select('*, consorcios(*)').order('periodo', { ascending: false }),
      supabase.from('proveedores').select('*').order('nombre'),
    ]);
    setMnts((m.data as Mantenimiento[]) || []);
    setLiqs((l.data as Liquidacion[]) || []);
    setProveedores((p.data as Proveedor[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const mntsVisibles = mnts
    .filter((m) => !fConsorcio || m.consorcio_id === fConsorcio)
    .filter((m) => (!fDesde || m.vencimiento >= fDesde) && (!fHasta || m.vencimiento <= fHasta))
    .filter((m) => !fProveedor || m.proveedor_id === fProveedor);

  /** Crea la liquidación del período siguiente en todos los consorcios activos que no la tengan. */
  const crearLiquidacionesMasivas = async () => {
    setBusy(true); setMsg('');
    let creadas = 0;
    for (const c of consorcios.filter((x) => x.activo)) {
      const propias = liqs.filter((l) => l.consorcio_id === c.id);
      const periodo = propias[0] ? periodoSiguiente(propias[0].periodo) : periodoActual();
      if (propias.some((l) => l.periodo === periodo)) continue;
      const [y, m] = periodo.split('-').map(Number);
      const fv = (dia: number) => new Date(y, m, Math.min(Number(dia) || 10, 28)).toISOString().slice(0, 10);
      const { error } = await supabase.from('liquidaciones').insert({
        consorcio_id: c.id, periodo,
        fecha_vencimiento_1: fv(c.dia_vencimiento_1), fecha_vencimiento_2: fv(c.dia_vencimiento_2),
        recargo_2do_venc_pct: c.recargo_2do_venc_pct, interes_mora_pct: c.interes_mora_mensual_pct,
      });
      if (!error) creadas++;
    }
    setMsg(`Se crearon ${creadas} liquidaciones nuevas.`);
    setBusy(false);
    load();
  };

  const copiarTabla = () => {
    const texto = mntsVisibles.map((m) =>
      [m.consorcios?.nombre, fmtDate(m.vencimiento), fmtDate(m.ultimo_mnt), m.mantenimiento_tipos?.nombre, m.proveedores?.nombre || '', m.descripcion || ''].join('\t')
    ).join('\n');
    navigator.clipboard.writeText('CONSORCIO\tVENCIMIENTO\tULTIMO MNT\tTIPO\tPROVEEDOR\tDESCRIPCIÓN\n' + texto);
    setMsg('Tabla copiada al portapapeles.');
  };

  const consorcioNombre = (id: string) => consorcios.find((c: Consorcio) => c.id === id)?.nombre || '—';

  return (
    <div>
      <PageHeader title="Acciones masivas" subtitle="Operaciones y controles sobre todos los consorcios a la vez" />
      {msg && <div className="bg-emerald-50 text-emerald-700 text-sm rounded-lg px-4 py-2.5 mb-4">{msg}</div>}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'mantenimientos', label: 'Mantenimientos', badge: mnts.filter((m) => m.vencimiento < hoy).length },
        { key: 'liquidaciones', label: 'Liquidaciones' },
      ]} />

      {loading ? <Spinner /> : tab === 'mantenimientos' ? (
        <>
          <Card className="p-4 mb-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="w-52"><Select label="Consorcio" value={fConsorcio} onChange={setFConsorcio} placeholder="Todos"
                options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} /></div>
              <div className="w-40"><Input label="Vencimiento desde" type="date" value={fDesde} onChange={setFDesde} /></div>
              <div className="w-40"><Input label="Hasta" type="date" value={fHasta} onChange={setFHasta} /></div>
              <div className="w-52"><Select label="Proveedor" value={fProveedor} onChange={setFProveedor} placeholder="Todos"
                options={proveedores.map((p) => ({ value: p.id, label: p.nombre }))} /></div>
              <Button variant="secondary" onClick={copiarTabla}><Copy size={14} /> Copiar tabla</Button>
            </div>
          </Card>
          <Card>
            <Table headers={['Consorcio', 'Vencimiento', 'Último mnt', 'Tipo', 'Proveedor', 'Descripción', 'Estado']}>
              {mntsVisibles.map((m) => {
                const est = estadoMnt(m.vencimiento);
                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <Td className="font-medium">{m.consorcios?.nombre}</Td>
                    <Td>{fmtDate(m.vencimiento)}</Td>
                    <Td>{fmtDate(m.ultimo_mnt)}</Td>
                    <Td>{m.mantenimiento_tipos?.nombre || '—'}</Td>
                    <Td className="text-slate-500">{m.proveedores?.nombre || '—'}</Td>
                    <Td className="text-slate-500 max-w-xs truncate">{m.descripcion || '—'}</Td>
                    <Td><Badge color={est.color}>{est.label}</Badge></Td>
                  </tr>
                );
              })}
              {mntsVisibles.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-400 py-10">No hay registros</Td></tr>}
            </Table>
          </Card>
        </>
      ) : (
        <>
          <Card className="p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-slate-600"><Zap size={14} className="inline mr-1 text-teal-500" />
              Crear la liquidación del próximo período en todos los consorcios activos que no la tengan.</p>
            <Button onClick={crearLiquidacionesMasivas} disabled={busy}><CheckCircle2 size={15} /> Crear liquidaciones del período</Button>
          </Card>
          <Card>
            <Table headers={['Consorcio', 'Período', 'Estado', 'Vencimiento', 'Gastos', 'Distribuido']}>
              {liqs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{consorcioNombre(l.consorcio_id)}</Td>
                  <Td>{l.periodo}</Td>
                  <Td><Badge color={l.estado === 'abierta' ? 'amber' : l.estado === 'cerrada' ? 'blue' : 'green'}>{l.estado.toUpperCase()}</Badge></Td>
                  <Td>{fmtDate(l.fecha_vencimiento_1)}</Td>
                  <Td>{fmtMoney(Number(l.total_gastos))}</Td>
                  <Td>{fmtMoney(Number(l.total_distribuido))}</Td>
                </tr>
              ))}
              {liqs.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-400 py-10">Sin liquidaciones</Td></tr>}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

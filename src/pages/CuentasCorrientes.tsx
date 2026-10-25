import { useEffect, useState } from 'react';
import { ArrowLeft, Download, FileBadge, Users, Wallet } from 'lucide-react';
import { supabase, type Administracion, type Cupon, type Pago, type Unidad } from '@/lib/supabase';
import { escHtml, imprimirHtml } from '@/lib/imprimir';
import { Ayuda } from '@/components/Ayuda';
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

  /** Certificado de deuda para iniciar el reclamo judicial (Ley 13.512 / CCyC art. 2048: título ejecutivo). */
  const certificado = async () => {
    const { data: adm } = await supabase.from('administracion').select('*').limit(1).maybeSingle();
    const a = adm as Administracion | null;
    const pend = cupones.map((c) => {
      const liq = c.liquidaciones as unknown as { periodo: string; fecha_vencimiento_1?: string };
      return { periodo: liq.periodo, venc: liq.fecha_vencimiento_1, total: Number(c.total), intereses: Number(c.intereses) };
    }).sort((x, y) => x.periodo.localeCompare(y.periodo));
    const pagado = pagos.reduce((x, p) => x + Number(p.monto), 0);
    // Se imputan los pagos a los períodos más viejos; lo que queda impago se detalla
    let resto = pagado; const impagos: typeof pend = [];
    for (const c of pend) { if (resto >= c.total - 0.01) { resto -= c.total; continue; } impagos.push({ ...c, total: round2(c.total - resto) }); resto = 0; }
    const hoy = new Date().toISOString().slice(0, 10);
    const html = `<div class="cab"><div><h1>CERTIFICADO DE DEUDA POR EXPENSAS</h1><div class="adm">${escHtml(a?.nombre || 'Administración')}${a?.rpa ? ` · RPA N° ${escHtml(a.rpa)}` : ''}${a?.cuit ? ` · CUIT ${escHtml(a.cuit)}` : ''}<br>${escHtml(a?.direccion || '')} ${a?.telefono ? `· Tel. ${escHtml(a.telefono)}` : ''}</div></div><div class="doc"><b>${fmtDate(hoy)}</b></div></div>
      <p>Quien suscribe, <b>${escHtml(a?.nombre || '______________________')}</b>, en su carácter de administrador/a del <b>Consorcio de Propietarios ${escHtml(consorcio?.nombre || '')}</b>, con domicilio en ${escHtml(consorcio?.direccion || '______________')}${consorcio?.ciudad ? `, ${escHtml(consorcio.ciudad)}` : ''}, CUIT ${escHtml(consorcio?.cuit || '______________')}, <b>CERTIFICA</b> que la unidad funcional <b>N° ${unidad.uf}</b> (${escHtml(unidad.depto)}${unidad.piso ? `, piso ${escHtml(unidad.piso)}` : ''}), cuyo titular registrado es <b>${escHtml(unidad.propietario || '______________')}</b>${unidad.propietario_dni ? ` (DNI ${escHtml(unidad.propietario_dni)})` : ''}, adeuda al consorcio en concepto de expensas comunes la suma de <b>${fmtMoney(saldoFinal)}</b>, conforme el siguiente detalle:</p>
      <table><thead><tr><th>Período</th><th>Vencimiento</th><th class="n">Importe adeudado</th><th class="n">de los cuales intereses</th></tr></thead><tbody>
      ${impagos.map((c) => `<tr><td>${escHtml(periodoLabel(c.periodo))}</td><td>${fmtDate(c.venc)}</td><td class="n">${fmtMoney(c.total)}</td><td class="n">${c.intereses ? fmtMoney(c.intereses) : '—'}</td></tr>`).join('')}
      <tr class="total"><td colspan="2">TOTAL ADEUDADO AL ${fmtDate(hoy)}</td><td class="n">${fmtMoney(saldoFinal)}</td><td></td></tr></tbody></table>
      <p class="chico">Los importes incluyen los intereses por mora liquidados hasta la fecha según lo aprobado por el consorcio (${consorcio?.interes_mora_mensual_pct || 0}% mensual). A partir de la fecha de este certificado se devengarán los intereses que correspondan hasta el efectivo pago, con más las costas y gastos que origine el reclamo.</p>
      <p class="chico">Se extiende el presente, que reviste el carácter de título ejecutivo en los términos del art. 2048 del Código Civil y Comercial de la Nación y el reglamento de copropiedad, a los efectos de iniciar las acciones legales correspondientes.</p>
      <div class="firma"><div>${escHtml(a?.nombre || '')}<br><span class="chico">Administrador/a · Firma y sello</span></div><div>&nbsp;<br><span class="chico">Lugar y fecha</span></div></div>`;
    imprimirHtml(`Certificado de deuda UF ${unidad.uf}`, html);
  };

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
        action={<div className="flex items-center gap-3">
          {saldoFinal > 1 ? <Badge color="red">Saldo deudor: {fmtMoney(saldoFinal)}</Badge>
            : saldoFinal < -1 ? <Badge color="green">Saldo a favor: {fmtMoney(-saldoFinal)}</Badge>
            : <Badge color="slate">Al día</Badge>}
          {saldoFinal > 1 && <Button variant="secondary" onClick={certificado}><FileBadge size={15} /> Certificado de deuda</Button>}
        </div>} />

      {saldoFinal > 1 && <Ayuda id="ctacte_cert" titulo="Cómo reclamar la deuda">
        <ol>
          <li><b>Intimación</b>: primero un comunicado o carta documento al propietario con el saldo y un plazo (10 días es lo usual). Podés ofrecer un plan de pagos (Expensas → Planes de pago).</li>
          <li><b>Certificado de deuda</b>: si no paga, el botón de arriba genera el certificado firmado por el administrador, que es título ejecutivo (art. 2048 CCyC). Se lo entregás al abogado junto con el reglamento de copropiedad, el acta de designación del administrador y las liquidaciones de los períodos adeudados (Expensas → Liquidaciones → PDF).</li>
          <li>El abogado inicia el <b>juicio ejecutivo de expensas</b>; las costas y honorarios se le reclaman al deudor.</li>
        </ol>
      </Ayuda>}
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

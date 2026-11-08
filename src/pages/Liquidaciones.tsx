import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Copy, FileBarChart, FilePlus2, FileText, FileUp, Lock, MoreHorizontal, Paperclip, Pencil, Plus, Receipt, RefreshCw, Send, Settings, Trash2, Unlock, Users } from 'lucide-react';
import { supabase, type Cupon, type Gasto, type Liquidacion, type Pago, type Proveedor, type Rubro } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { GastoModal } from '@/components/GastoModal';
import { EnvioExpensas } from '@/components/EnvioExpensas';
import { ImportarLiquidacion } from '@/components/ImportarLiquidacion';
import { ConfigExpensas } from '@/components/ConfigExpensas';
import { imprimirResumenExpensas } from '@/lib/resumenExpensas';
import {
  ajustarVencimiento, CATEGORIAS, cerrarLiquidacion, eliminarPago, fmtDate, fmtMoney, generarCupones, hoyISO,
  montoEsperado, notificar, periodoActual, periodoLabel, periodoSiguiente, reabrirLiquidacion, registrarPago, round2,
} from '@/lib/engine';

const estadoLiq: Record<string, { color: 'amber' | 'blue' | 'green'; label: string }> = {
  abierta: { color: 'amber', label: 'ABIERTA' },
  cerrada: { color: 'blue', label: 'CERRADA' },
  enviada: { color: 'green', label: 'ENVIADA' },
};

export function Liquidaciones() {
  const { consorcio, usuario } = useApp();
  const [liqs, setLiqs] = useState<Liquidacion[]>([]);
  const [cobradoPorLiq, setCobradoPorLiq] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [importar, setImportar] = useState(false);
  const [nuevaModal, setNuevaModal] = useState(false);
  const [configModal, setConfigModal] = useState(false);
  const [creando, setCreando] = useState(false);
  const { reloadConsorcios } = useApp();
  const [editar, setEditar] = useState<Liquidacion | null>(null);
  const [editForm, setEditForm] = useState({ nombre: '', fecha_vencimiento_1: '', fecha_vencimiento_2: '', notas: '' });
  const [eliminar, setEliminar] = useState<Liquidacion | null>(null);
  const [menuMas, setMenuMas] = useState<string | null>(null);
  const [totalesGastos, setTotalesGastos] = useState<Record<string, number>>({});

  const guardarEdicion = async () => {
    if (!editar) return;
    const { error } = await supabase.from('liquidaciones').update({
      nombre: editForm.nombre.trim() || null, fecha_vencimiento_1: editForm.fecha_vencimiento_1 || null, fecha_vencimiento_2: editForm.fecha_vencimiento_2 || null, notas: editForm.notas || null,
    }).eq('id', editar.id);
    if (error) { setMsg(error.message); return; }
    setEditar(null); load();
  };

  /** Eliminar expensa: los gastos vuelven a "pendientes" del edificio; se borran cupones. Sólo si no tiene pagos. */
  const eliminarLiq = async () => {
    if (!eliminar) return;
    const { count } = await supabase.from('pagos').select('id', { count: 'exact', head: true }).in('cupon_id', (await supabase.from('cupones').select('id').eq('liquidacion_id', eliminar.id)).data?.map((c) => c.id) || ['00000000-0000-0000-0000-000000000000']);
    if (count) { setMsg('No se puede eliminar: tiene cobranzas registradas. Reabrila y corregila, o eliminá primero los pagos.'); setEliminar(null); return; }
    await supabase.from('gastos').update({ liquidacion_id: null }).eq('liquidacion_id', eliminar.id);
    await supabase.from('cupones').delete().eq('liquidacion_id', eliminar.id);
    await supabase.from('cola_envios').delete().eq('liquidacion_id', eliminar.id);
    const { error } = await supabase.from('liquidaciones').delete().eq('id', eliminar.id);
    if (error) { setMsg(error.message); return; }
    setMsg(`Liquidación ${periodoLabel(eliminar.periodo)} eliminada. Sus gastos quedaron en Gastos pendientes.`);
    setEliminar(null); load();
  };

  const adjuntarExtracto = async (l: Liquidacion, f: File) => {
    const path = `extractos/${l.consorcio_id}/${l.periodo}_${Date.now()}_${f.name.replace(/[^\w.\-]/g, '_')}`;
    const { error } = await supabase.storage.from('archivos').upload(path, f);
    if (error) { setMsg(`No se pudo subir el extracto: ${error.message}`); return; }
    await supabase.from('liquidaciones').update({ extracto_path: path }).eq('id', l.id);
    setMsg('Extracto adjuntado.'); load();
  };

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const { data } = await supabase.from('liquidaciones').select('*').eq('consorcio_id', consorcio.id).order('periodo', { ascending: false });
    const ls = (data as Liquidacion[]) || [];
    setLiqs(ls);
    // cobrado por liquidación: pagos imputados a cupones de cada liq
    const { data: pagos } = await supabase.from('pagos')
      .select('monto, cupones!inner(liquidacion_id)').eq('consorcio_id', consorcio.id).not('cupon_id', 'is', null);
    const map: Record<string, number> = {};
    for (const p of (pagos || []) as unknown as { monto: number; cupones: { liquidacion_id: string } }[]) {
      map[p.cupones.liquidacion_id] = (map[p.cupones.liquidacion_id] || 0) + Number(p.monto);
    }
    setCobradoPorLiq(map);
    // Gastos cargados por liquidación (las abiertas todavía no tienen total_gastos calculado)
    const { data: gs } = await supabase.from('gastos').select('liquidacion_id, monto').eq('consorcio_id', consorcio.id).not('liquidacion_id', 'is', null);
    const tg: Record<string, number> = {};
    for (const g of (gs || []) as { liquidacion_id: string; monto: number }[]) tg[g.liquidacion_id] = (tg[g.liquidacion_id] || 0) + Number(g.monto);
    setTotalesGastos(tg);
    setLoading(false);
  };
  useEffect(() => { setDetalleId(null); load(); }, [consorcio?.id]);

  /**
   * Nueva expensa. "Copiar la última": trae los gastos marcados como recurrentes de la última liquidación
   * (mismos importes, fecha de hoy, sin pagar) para que sólo haya que ajustar. "En blanco": vacía.
   */
  const nueva = async (copiar: boolean) => {
    if (!consorcio || creando) return;
    setCreando(true); setMsg('');
    const ultima = liqs[0];
    const periodo = ultima ? periodoSiguiente(ultima.periodo) : periodoActual();
    const [y, m] = periodo.split('-').map(Number);
    const fv = (dia: number) => {
      const next = new Date(y, m, Math.min(Number(dia) || 10, 28)); // vence el mes siguiente al período liquidado
      return ajustarVencimiento(next.toISOString().slice(0, 10), consorcio.venc_no_habil);
    };
    const { data, error } = await supabase.from('liquidaciones').insert({
      consorcio_id: consorcio.id, periodo,
      fecha_vencimiento_1: fv(consorcio.dia_vencimiento_1),
      fecha_vencimiento_2: fv(consorcio.dia_vencimiento_2),
      recargo_2do_venc_pct: consorcio.recargo_2do_venc_pct,
      interes_mora_pct: consorcio.interes_mora_mensual_pct,
    }).select().single();
    if (error) { setMsg(error.message); setCreando(false); return; }
    let copiados = 0;
    if (copiar && ultima) {
      const { data: rec } = await supabase.from('gastos').select('*').eq('liquidacion_id', ultima.id).eq('recurrente', true);
      const filas = ((rec || []) as Gasto[]).map((g) => ({
        consorcio_id: consorcio.id, liquidacion_id: data.id, proveedor_id: g.proveedor_id, rubro_id: g.rubro_id, descripcion: g.descripcion,
        categoria: g.categoria, monto: g.monto, monto_a: g.monto_a, monto_b: g.monto_b, monto_c: g.monto_c, monto_d: g.monto_d,
        fecha: hoyISO(), periodo_facturado: periodo, tipo_comprobante: g.tipo_comprobante, comprobante: null, recurrente: true,
        extraordinario: g.extraordinario, notas: g.notas, pagado: false,
      }));
      if (filas.length) { const { error: e2 } = await supabase.from('gastos').insert(filas); if (!e2) copiados = filas.length; }
    }
    setNuevaModal(false); setCreando(false);
    await load();
    if (copiados) setMsg(`Liquidación ${periodoLabel(periodo)} creada con ${copiados} gastos recurrentes copiados. Revisá importes y cargá los comprobantes.`);
    setDetalleId(data.id);
  };

  if (!consorcio) return null;
  if (detalleId) {
    const liq = liqs.find((l) => l.id === detalleId);
    if (liq) return <LiquidacionDetalle liq={liq} usuario={usuario} onBack={() => { setDetalleId(null); load(); }} />;
  }

  const actual = liqs[0];
  const anterior = liqs[1];

  return (
    <div>
      <PageHeader title={`Expensas · ${consorcio.nombre}`} subtitle="Liquidaciones mensuales"
        action={<div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => setConfigModal(true)}><Settings size={15} /> Configuración</Button>
          <Button variant="secondary" onClick={() => setImportar(true)}><FileUp size={15} /> Importar PDF</Button>
          <Button onClick={() => setNuevaModal(true)}><Plus size={16} /> Nueva expensa</Button>
        </div>} />
      {msg && <p className={`text-sm mb-3 ${/creada/.test(msg) ? 'text-emerald-600' : 'text-red-500'}`}>{msg}</p>}
      <ConfigExpensas open={configModal} onClose={() => setConfigModal(false)} consorcio={consorcio} onGuardado={reloadConsorcios} />
      <Modal open={nuevaModal} onClose={() => setNuevaModal(false)} title="Nueva liquidación">
        <p className="text-sm text-slate-500 mb-5">Seleccioná cómo crear la expensa de <b>{periodoLabel(liqs[0] ? periodoSiguiente(liqs[0].periodo) : periodoActual())}</b>:</p>
        <div className="grid grid-cols-2 gap-4">
          <button disabled={!liqs[0] || creando} onClick={() => nueva(true)} className="rounded-xl border-2 border-pink-400 text-pink-600 p-5 text-center hover:bg-pink-50 disabled:opacity-40">
            <Copy size={26} className="mx-auto mb-2" /><div className="font-bold text-sm">COPIAR LA ÚLTIMA</div>
            <div className="text-xs text-slate-500 mt-2">Trae los gastos marcados como recurrentes (abono de limpieza, ascensores, honorarios…) con sus importes, para ajustar.</div>
          </button>
          <button disabled={creando} onClick={() => nueva(false)} className="rounded-xl border-2 border-teal-400 text-teal-600 p-5 text-center hover:bg-teal-50 disabled:opacity-40">
            <FilePlus2 size={26} className="mx-auto mb-2" /><div className="font-bold text-sm">CREAR EN BLANCO</div>
            <div className="text-xs text-slate-500 mt-2">Sin gastos. Después podés traer los pendientes y generar las provisiones desde la liquidación.</div>
          </button>
        </div>
        <div className="flex justify-end mt-5"><Button variant="secondary" onClick={() => setNuevaModal(false)}>Cancelar</Button></div>
      </Modal>
      <ImportarLiquidacion open={importar} onClose={() => setImportar(false)} consorcioId={consorcio.id}
        onImportado={async (_cid, liqId) => { await load(); setDetalleId(liqId); }} />

      {loading ? <Spinner /> : liqs.length === 0 ? (
        <Card><EmptyState icon={<Receipt size={28} />} title="Todavía no hay liquidaciones" subtitle="Creá la primera liquidación del período para empezar a cargar gastos." /></Card>
      ) : (
        <>
          {/* Cards de los dos últimos períodos, como en Octavo */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {[anterior, actual].filter(Boolean).map((l) => {
              const cobrado = cobradoPorLiq[l!.id] || 0;
              const pct = l!.total_distribuido > 0 ? (cobrado / Number(l!.total_distribuido)) * 100 : 0;
              const abierta = l!.estado === 'abierta';
              const btn = 'inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-teal-600 px-1.5 py-1';
              return (
                <Card key={l!.id} className="p-5 relative">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-teal-600 font-semibold">{l!.nombre || periodoLabel(l!.periodo)}</p>
                      {abierta ? <>
                        <p className="text-xs text-slate-400 mt-0.5">Gastos</p>
                        <p className="text-2xl font-bold text-slate-800">{fmtMoney(totalesGastos[l!.id] || 0)}</p>
                        <button onClick={() => setDetalleId(l!.id)} className="mt-1 text-xs font-semibold text-teal-700 bg-teal-50 rounded-full px-3 py-1">Imputación de gastos</button>
                      </> : <>
                        <p className="text-xs text-slate-400 mt-0.5">Recaudado</p>
                        <p className="text-2xl font-bold text-slate-800">{fmtMoney(cobrado)}</p>
                        <button onClick={() => { setDetalleId(l!.id); }} className="mt-1 text-xs font-semibold text-teal-700 bg-teal-50 rounded-full px-3 py-1">Registro de cobranza</button>
                      </>}
                      {l!.cerrada_por && <p className="text-[11px] text-slate-400 mt-2">Cerrada por {l!.cerrada_por} el {fmtDate(l!.cerrada_at?.slice(0, 10))}</p>}
                      {l!.enviada_at && <p className="text-[11px] text-slate-400">Enviada a todos el {fmtDate(l!.enviada_at.slice(0, 10))}</p>}
                    </div>
                    {abierta ? (
                      <div className="text-right text-xs text-slate-500 shrink-0">
                        <p>1er vencimiento</p><p className="font-semibold text-slate-700 text-sm">{fmtDate(l!.fecha_vencimiento_1)}</p>
                        <p className="mt-1">2do vencimiento</p><p className="font-semibold text-slate-700 text-sm">{fmtDate(l!.fecha_vencimiento_2)}</p>
                      </div>
                    ) : (
                      <div className="relative w-20 h-20 rounded-full shrink-0" style={{ background: `conic-gradient(#14b8a6 ${Math.min(100, pct) * 3.6}deg, #e2e8f0 0deg)` }}>
                        <div className="absolute inset-1.5 bg-white rounded-full flex flex-col items-center justify-center">
                          <span className="text-sm font-bold text-slate-700">{Math.round(pct)}%</span>
                          <span className="text-[9px] text-slate-400">Cobranza</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 mt-4 pt-3 border-t border-slate-100 flex-wrap items-center">
                    {abierta ? <>
                      <button className={btn} onClick={() => setDetalleId(l!.id)}><RefreshCw size={13} /> Simular</button>
                      <button className={btn} onClick={() => setDetalleId(l!.id)} title="Unidades con deuda"><Users size={13} /> Ajustes</button>
                      <button className={btn} onClick={() => setDetalleId(l!.id)}><Lock size={13} /> Cerrar</button>
                      <button className={btn} onClick={() => { setEditForm({ nombre: l!.nombre || '', fecha_vencimiento_1: l!.fecha_vencimiento_1 || '', fecha_vencimiento_2: l!.fecha_vencimiento_2 || '', notas: l!.notas || '' }); setEditar(l!); }}><Pencil size={13} /> Editar</button>
                    </> : <>
                      <button className={btn} onClick={() => imprimirResumenExpensas(l!, consorcio)}><FileText size={13} /> Resumen</button>
                      <button className={btn} onClick={() => setDetalleId(l!.id)}><Receipt size={13} /> Cupones</button>
                      <button className={btn} onClick={() => setDetalleId(l!.id)}><Send size={13} /> Enviar</button>
                      <button className={btn} onClick={() => setDetalleId(l!.id)}><Unlock size={13} /> Reabrir</button>
                    </>}
                    <div className="relative">
                      <button className={btn} onClick={() => setMenuMas(menuMas === l!.id ? null : l!.id)}><MoreHorizontal size={13} /> Más</button>
                      {menuMas === l!.id && (
                        <div className="absolute right-0 top-7 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-56 text-sm" onMouseLeave={() => setMenuMas(null)}>
                          {!abierta && <button className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={() => setDetalleId(l!.id)}><FileBarChart size={13} className="inline mr-2" />Ver gastos</button>}
                          {!abierta && <button className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={() => setDetalleId(l!.id)}><Users size={13} className="inline mr-2" />Ver ajustes</button>}
                          <label className="block px-3 py-2 hover:bg-slate-50 cursor-pointer"><Paperclip size={13} className="inline mr-2" />{l!.extracto_path ? 'Reemplazar extracto' : 'Adjuntar extracto'}<input type="file" className="hidden" accept="application/pdf,image/*,.csv,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; setMenuMas(null); if (f) adjuntarExtracto(l!, f); }} /></label>
                          {l!.extracto_path && <a className="block px-3 py-2 hover:bg-slate-50" href={supabase.storage.from('archivos').getPublicUrl(l!.extracto_path).data.publicUrl} target="_blank" rel="noopener"><FileText size={13} className="inline mr-2" />Ver extracto</a>}
                          <button className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600" onClick={() => { setMenuMas(null); setEliminar(l!); }}><Trash2 size={13} className="inline mr-2" />Eliminar expensa</button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <Modal open={!!editar} onClose={() => setEditar(null)} title={`Datos de la liquidación · ${editar ? periodoLabel(editar.periodo) : ''}`}>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Período informado" value={editar?.periodo || ''} onChange={() => {}} />
              <Input label="Nombre del período" value={editForm.nombre} onChange={(v) => setEditForm({ ...editForm, nombre: v })} placeholder={editar ? periodoLabel(editar.periodo) : ''} />
              <Input label="Primer vencimiento" type="date" value={editForm.fecha_vencimiento_1} onChange={(v) => setEditForm({ ...editForm, fecha_vencimiento_1: v })} />
              <Input label="Segundo vencimiento" type="date" value={editForm.fecha_vencimiento_2} onChange={(v) => setEditForm({ ...editForm, fecha_vencimiento_2: v })} />
              <div className="col-span-2"><Textarea label="Notas visibles en esta expensa (normas de convivencia, avisos)" value={editForm.notas} onChange={(v) => setEditForm({ ...editForm, notas: v })} rows={6} /></div>
            </div>
            <p className="text-xs text-slate-400 mt-2">Las notas salen en el mail de expensas y en el portal del vecino. Si el período ya está cerrado, cambiar los vencimientos no recalcula los cupones: reabrilo para eso.</p>
            <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setEditar(null)}>Cancelar</Button><Button onClick={guardarEdicion}>Guardar</Button></div>
          </Modal>
          <ConfirmDialog open={!!eliminar} title="Eliminar expensa" peligro confirmLabel="Eliminar"
            message={`Se elimina la expensa de ${eliminar ? periodoLabel(eliminar.periodo) : ''}. Los gastos quedan asignados al edificio como pendientes (no se pierden) y se borran los cupones. ¿Continuar?`}
            onCancel={() => setEliminar(null)} onConfirm={eliminarLiq} />

          <Card>
            <Table headers={['Período', 'Vencimiento', 'Estado', 'Gastos', 'Distribuido', 'Cobrado', 'Cumplimiento', '']}>
              {liqs.map((l) => {
                const cobrado = cobradoPorLiq[l.id] || 0;
                const pct = l.total_distribuido > 0 ? Math.min(100, (cobrado / Number(l.total_distribuido)) * 100) : 0;
                return (
                  <tr key={l.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetalleId(l.id)}>
                    <Td className="font-medium">{l.periodo}{l.nombre && <span className="block text-xs text-slate-400 font-normal">{l.nombre}</span>}</Td>
                    <Td>{fmtDate(l.fecha_vencimiento_1)}</Td>
                    <Td><Badge color={estadoLiq[l.estado].color}>{estadoLiq[l.estado].label}</Badge></Td>
                    <Td>{fmtMoney(Number(l.total_gastos) || totalesGastos[l.id] || 0)}</Td>
                    <Td>{fmtMoney(Number(l.total_distribuido))}</Td>
                    <Td>{fmtMoney(cobrado)}</Td>
                    <Td>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500" style={{ width: `${pct}%` }} /></div>
                        <span className="text-xs text-slate-500 w-10">{Math.round(pct)}%</span>
                      </div>
                    </Td>
                    <Td><span className="text-teal-600 text-xs font-medium">Abrir →</span></Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

// ==================== Detalle de liquidación ====================

function LiquidacionDetalle({ liq: liqInicial, usuario, onBack }: { liq: Liquidacion; usuario: string; onBack: () => void }) {
  const { consorcio } = useApp();
  const [liq, setLiq] = useState(liqInicial);
  const [tab, setTab] = useState('gastos');
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [cupones, setCupones] = useState<Cupon[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [pendientes, setPendientes] = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'warn'; texto: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);

  // modales
  const [gastoModal, setGastoModal] = useState(false);
  const [gastoEdit, setGastoEdit] = useState<Gasto | null>(null);
  const [rubroNuevo, setRubroNuevo] = useState<string | null>(null);
  const [filtroCob, setFiltroCob] = useState<'todos' | 'pendientes' | 'pagados'>('todos');
  const [gastoForm, setGastoForm] = useState({ descripcion: '', proveedor_id: '', rubro_id: '', categoria: 'A', monto: '', fecha: hoyISO(), comprobante: '' });
  const [pagoModal, setPagoModal] = useState<Cupon | null>(null);
  const [pagoForm, setPagoForm] = useState({ fecha: hoyISO(), monto: '', metodo: 'transferencia', comprobante: '', observaciones: '' });

  const abierta = liq.estado === 'abierta';

  const loadAll = async () => {
    setLoading(true);
    const [g, c, pr, r, pend, l] = await Promise.all([
      supabase.from('gastos').select('*, proveedores(*), rubros(*)').eq('liquidacion_id', liq.id).order('fecha'),
      supabase.from('cupones').select('*, unidades(*)').eq('liquidacion_id', liq.id),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('rubros').select('*').order('orden'),
      supabase.from('gastos').select('*, proveedores(*)').eq('consorcio_id', liq.consorcio_id).is('liquidacion_id', null),
      supabase.from('liquidaciones').select('*').eq('id', liq.id).single(),
    ]);
    setGastos((g.data as Gasto[]) || []);
    const cs = ((c.data as Cupon[]) || []).sort((a, b) => (a.unidades?.uf || 0) - (b.unidades?.uf || 0));
    setCupones(cs);
    setProveedores((pr.data as Proveedor[]) || []);
    setRubros((r.data as Rubro[]) || []);
    setPendientes((pend.data as Gasto[]) || []);
    if (l.data) setLiq(l.data as Liquidacion);
    if (cs.length > 0) {
      const { data: pg } = await supabase.from('pagos').select('*, unidades(*)').in('cupon_id', cs.map((x) => x.id)).order('fecha', { ascending: false });
      setPagos((pg as Pago[]) || []);
    } else setPagos([]);
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, [liq.id]);

  const totalesPorCat = useMemo(() => {
    const t: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const g of gastos) { t.A += Number(g.monto_a); t.B += Number(g.monto_b); t.C += Number(g.monto_c); t.D += Number(g.monto_d); }
    return t;
  }, [gastos]);
  const totalGastos = round2(totalesPorCat.A + totalesPorCat.B + totalesPorCat.C + totalesPorCat.D);
  const totalCobrado = round2(pagos.reduce((a, p) => a + Number(p.monto), 0));

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try {
      const texto = await fn();
      if (texto) setMsg({ tipo: 'ok', texto });
      await loadAll();
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  // ---- acciones de gastos ----
  const agregarGasto = () => run(async () => {
    if (!gastoForm.descripcion.trim() || !gastoForm.monto) throw new Error('Completá descripción y monto.');
    const { error } = await supabase.from('gastos').insert({
      consorcio_id: liq.consorcio_id, liquidacion_id: liq.id,
      proveedor_id: gastoForm.proveedor_id || null, rubro_id: gastoForm.rubro_id || null,
      descripcion: gastoForm.descripcion.trim(), categoria: gastoForm.categoria,
      monto: parseFloat(gastoForm.monto), fecha: gastoForm.fecha, comprobante: gastoForm.comprobante || null,
    });
    if (error) throw new Error(error.message);
    setGastoModal(false);
    setGastoForm({ descripcion: '', proveedor_id: '', rubro_id: '', categoria: 'A', monto: '', fecha: hoyISO(), comprobante: '' });
  });

  const adjuntarFactura = (g: Gasto, f: File) => run(async () => {
    const path = `facturas/${g.consorcio_id}/${Date.now()}_${f.name.replace(/[^\w.\-]/g, '_')}`;
    const { error } = await supabase.storage.from('archivos').upload(path, f);
    if (error) throw new Error(`No se pudo subir la factura: ${error.message}`);
    await supabase.from('gastos').update({ archivo_path: path }).eq('id', g.id);
    return 'Factura adjuntada.';
  });

  const quitarGasto = (g: Gasto) => run(async () => {
    const { error } = await supabase.from('gastos').update({ liquidacion_id: null }).eq('id', g.id);
    if (error) throw new Error(error.message);
    return 'Gasto desvinculado (quedó en Gastos pendientes).';
  });

  const traerPendientes = () => run(async () => {
    if (pendientes.length === 0) throw new Error('No hay gastos pendientes de este consorcio.');
    const { error } = await supabase.from('gastos').update({ liquidacion_id: liq.id }).eq('consorcio_id', liq.consorcio_id).is('liquidacion_id', null);
    if (error) throw new Error(error.message);
    return `Se vincularon ${pendientes.length} gastos pendientes al período.`;
  });

  const generarProvisiones = () => run(async () => {
    const { data: provs } = await supabase.from('provisiones').select('*').eq('consorcio_id', liq.consorcio_id).eq('activa', true);
    let n = 0;
    const filas = [];
    for (const p of provs || []) {
      if (gastos.some((g) => g.descripcion === `${p.descripcion} (provisión ${liq.periodo})`)) continue;
      filas.push({
        consorcio_id: liq.consorcio_id, liquidacion_id: liq.id, proveedor_id: p.proveedor_id,
        rubro_id: p.rubro_id, descripcion: `${p.descripcion} (provisión ${liq.periodo})`,
        categoria: p.categoria, monto: p.monto_mensual, fecha: hoyISO(),
      });
      n++;
    }
    if (consorcio && Number(consorcio.honorarios_mensuales) > 0 && !gastos.some((g) => g.descripcion === `Honorarios administración ${liq.periodo}`)) {
      const rubroAdm = rubros.find((r) => r.nombre.toLowerCase().includes('honorarios'));
      filas.push({
        consorcio_id: liq.consorcio_id, liquidacion_id: liq.id, proveedor_id: null,
        rubro_id: rubroAdm?.id || null, descripcion: `Honorarios administración ${liq.periodo}`,
        categoria: 'A', monto: consorcio.honorarios_mensuales, fecha: hoyISO(),
      });
      n++;
    }
    if (filas.length === 0) throw new Error('No hay provisiones activas (ni honorarios) para generar, o ya fueron generadas.');
    const { error } = await supabase.from('gastos').insert(filas);
    if (error) throw new Error(error.message);
    return `Se generaron ${n} gastos (provisiones + honorarios).`;
  });

  // ---- acciones de liquidación ----
  /** Simular: genera los cupones provisorios sobre la liquidación abierta y abre el resumen marcado como simulación. */
  const simular = () => run(async () => {
    const res = await generarCupones(liq.id);
    await loadAll();
    await imprimirResumenExpensas({ ...liq, total_gastos: res.totalGastos, total_distribuido: res.totalDistribuido }, consorcio!, true);
    return `Simulación: ${res.cupones} cupones, ${fmtMoney(res.totalDistribuido)} a distribuir.${res.advertencias.length ? ' ' + res.advertencias.join(' ') : ''}`;
  });

  const previsualizar = () => run(async () => {
    const res = await generarCupones(liq.id);
    if (res.advertencias.length) setMsg({ tipo: 'warn', texto: res.advertencias.join(' ') });
    setTab('cupones');
    return res.advertencias.length ? undefined : `Cupones generados: ${res.cupones} UF · Distribuido ${fmtMoney(res.totalDistribuido)}.`;
  });

  const cerrar = () => setConfirm({
    title: 'Cerrar liquidación',
    message: `Se van a generar los cupones definitivos de ${periodoLabel(liq.periodo)} (gastos ${fmtMoney(totalGastos)} + saldos anteriores e intereses) y el período queda congelado. ¿Continuar?`,
    action: async () => {
      const res = await cerrarLiquidacion(liq.id, usuario);
      await notificar('info', `Liquidación ${liq.periodo} cerrada`, `${consorcio?.nombre}: ${res.cupones} cupones por ${fmtMoney(res.totalDistribuido)}.`);
      if (res.advertencias.length) setMsg({ tipo: 'warn', texto: res.advertencias.join(' ') });
      setTab('cupones');
    },
  });

  const enviar = () => setConfirm({
    title: 'Enviar expensas',
    message: 'Marca la liquidación como ENVIADA a todos los propietarios (los cupones quedan publicados). ¿Continuar?',
    action: async () => {
      const { error } = await supabase.from('liquidaciones').update({ estado: 'enviada', enviada_at: new Date().toISOString() }).eq('id', liq.id);
      if (error) throw new Error(error.message);
      await notificar('info', `Expensas ${liq.periodo} enviadas`, consorcio?.nombre);
    },
  });

  const reabrir = () => setConfirm({
    title: 'Reabrir liquidación',
    message: 'La liquidación vuelve a ABIERTA para corregir gastos. Al volver a cerrarla, los cupones se regeneran (los pagos ya registrados se conservan y se re-imputan por saldo). ¿Continuar?',
    action: async () => { await reabrirLiquidacion(liq.id); },
  });

  // ---- cobranza ----
  const abrirPago = (c: Cupon) => {
    const esperado = montoEsperado(c, liq.fecha_vencimiento_1, liq.fecha_vencimiento_2);
    const pagado = pagos.filter((p) => p.cupon_id === c.id).reduce((a, p) => a + Number(p.monto), 0);
    setPagoForm({ fecha: hoyISO(), monto: String(round2(Math.max(0, esperado.monto - pagado))), metodo: 'transferencia', comprobante: '', observaciones: '' });
    setPagoModal(c);
  };

  const guardarPago = () => run(async () => {
    if (!pagoModal) return;
    const monto = parseFloat(pagoForm.monto);
    if (!monto || monto <= 0) throw new Error('Ingresá un monto válido.');
    await registrarPago({
      consorcio_id: liq.consorcio_id, unidad_id: pagoModal.unidad_id, cupon_id: pagoModal.id,
      fecha: pagoForm.fecha, monto, metodo: pagoForm.metodo,
      comprobante: pagoForm.comprobante, observaciones: pagoForm.observaciones, registrado_por: usuario,
    });
    setPagoModal(null);
    return 'Pago registrado.';
  });

  const borrarPago = (p: Pago) => setConfirm({
    title: 'Eliminar pago',
    message: `¿Eliminar el pago de ${fmtMoney(Number(p.monto))} del ${fmtDate(p.fecha)}? También se borra su movimiento de caja.`,
    action: async () => { await eliminarPago(p.id); },
  });

  const catLabel = (k: string) => CATEGORIAS.find((c) => c.key === k)?.label || k;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-teal-600 font-medium mb-3 hover:underline"><ArrowLeft size={15} /> Volver a liquidaciones</button>
      <PageHeader title={`${periodoLabel(liq.periodo)} · ${consorcio?.nombre}`}
        subtitle={`1º venc. ${fmtDate(liq.fecha_vencimiento_1)} · 2º venc. ${fmtDate(liq.fecha_vencimiento_2)} (+${liq.recargo_2do_venc_pct}%)${Number(liq.interes_mora_pct) > 0 ? ` · Mora ${liq.interes_mora_pct}%/mes` : ''}`}
        action={
          <div className="flex gap-2 flex-wrap items-center">
            <Badge color={estadoLiq[liq.estado].color}>{estadoLiq[liq.estado].label}</Badge>
            {abierta && <Button variant="secondary" onClick={simular} disabled={busy}><RefreshCw size={15} /> Simular</Button>}
            {!abierta && <Button variant="secondary" onClick={() => imprimirResumenExpensas(liq, consorcio!)}><FileText size={15} /> Resumen (PDF)</Button>}
            {abierta && <Button onClick={cerrar} disabled={busy}><Lock size={15} /> Cerrar período</Button>}
            {!abierta && <Button onClick={() => setTab('envios')}><Send size={15} /> Enviar</Button>}
            {!abierta && <Button variant="secondary" onClick={reabrir} disabled={busy}><Unlock size={15} /> Reabrir</Button>}
          </div>
        } />

      {msg && (
        <div className={`text-sm rounded-lg px-4 py-2.5 mb-4 ${msg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : msg.tipo === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
          {msg.texto}
        </div>
      )}

      {/* Resumen numérico */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Card className="p-4"><p className="text-xs text-slate-400">Gastos del período</p><p className="text-lg font-bold text-slate-800">{fmtMoney(totalGastos)}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Distribuido (c/saldos e int.)</p><p className="text-lg font-bold text-slate-800">{fmtMoney(Number(liq.total_distribuido))}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Cobrado</p><p className="text-lg font-bold text-emerald-600">{fmtMoney(totalCobrado)}</p></Card>
        <Card className="p-4"><p className="text-xs text-slate-400">Cobranza</p><p className="text-lg font-bold text-slate-800">{Number(liq.total_distribuido) > 0 ? Math.round((totalCobrado / Number(liq.total_distribuido)) * 100) : 0}%</p></Card>
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'gastos', label: 'Gastos', badge: gastos.length },
        { key: 'cupones', label: 'Cupones', badge: cupones.length },
        { key: 'cobranza', label: 'Cobranza', badge: pagos.length },
        { key: 'envios', label: 'Envío por mail' },
      ]} />

      {loading ? <Spinner /> : tab === 'gastos' ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
            {abierta && <Button size="sm" onClick={() => { setGastoEdit(null); setRubroNuevo(null); setGastoModal(true); }}><Plus size={14} /> Agregar gasto</Button>}
            {abierta && <Button size="sm" variant="secondary" onClick={traerPendientes} disabled={busy}>Traer gastos pendientes ({pendientes.length})</Button>}
            {abierta && <Button size="sm" variant="secondary" onClick={generarProvisiones} disabled={busy}>Generar provisiones y honorarios</Button>}
            {!abierta && <p className="text-xs text-slate-400 py-1">Período cerrado: para modificar gastos hay que reabrir.</p>}
            <div className="flex-1" />
            <div className="flex gap-3 text-xs text-slate-500 pr-2">
              {CATEGORIAS.map((c) => <span key={c.key}><b>{c.key}:</b> {fmtMoney(totalesPorCat[c.key])}</span>)}
            </div>
          </div>
          {/* Imputación de gastos, agrupada por rubro como en Octavo */}
          <div className="px-4 pb-4 mt-3 space-y-3">
            {(() => {
              const total = gastos.reduce((a, g) => a + Number(g.monto), 0);
              const grupos = rubros.map((r) => ({ r, items: gastos.filter((g) => g.rubro_id === r.id) }));
              const sinRubro = gastos.filter((g) => !g.rubro_id);
              const filas = [...grupos, ...(sinRubro.length ? [{ r: { id: '', nombre: 'Sin rubro', orden: 999 } as Rubro, items: sinRubro }] : [])];
              if (filas.every((f) => f.items.length === 0)) return <p className="text-center text-slate-400 py-10">Sin gastos cargados en este período.{abierta ? ' Agregalos con "+ Agregar" en cada rubro, traé los pendientes o copiá la última expensa.' : ''}</p>;
              return filas.map(({ r, items }, idx) => {
                const sub = items.reduce((a, g) => a + Number(g.monto), 0);
                if (!items.length && !abierta) return null;
                return (
                  <div key={r.id || 'sin'} className="rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#1e2a4a] rounded-t-lg">
                      <span className="text-xs text-white/60 w-5 font-semibold">{idx + 1}</span>
                      <span className="font-bold text-white text-sm uppercase tracking-wide">{r.nombre}</span>
                      {sub > 0 && <span className="text-[10px] font-bold text-[#1e2a4a] bg-teal-300 rounded px-1.5 py-0.5">{total ? Math.round(sub / total * 100) : 0}%</span>}
                      <div className="flex-1" />
                      {abierta && r.id && <button onClick={() => { setGastoEdit(null); setRubroNuevo(r.id); setGastoModal(true); }} className="text-xs font-semibold text-white border border-white/40 rounded px-2 py-1 hover:bg-white/15">+ Agregar</button>}
                    </div>
                    {items.length === 0 ? <p className="text-xs text-slate-400 px-4 py-2">Sin movimientos</p> : items.map((g) => (
                      <div key={g.id} className="flex items-start gap-3 px-4 py-2.5 border-t border-slate-100 hover:bg-slate-50/60">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{g.descripcion}{g.proveedores?.nombre && <span className="text-slate-400 font-normal"> · {g.proveedores.nombre}</span>}{g.comprobante && <span className="text-slate-400 font-normal"> · {g.tipo_comprobante} {g.comprobante}</span>}{g.periodo_facturado && <span className="text-slate-400 font-normal"> · {g.periodo_facturado}</span>}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(g.fecha)} · {g.pagado ? `Pagado ${g.fecha_pago ? fmtDate(g.fecha_pago) : ''}` : 'Pendiente de pago'}{g.recurrente ? ' · Recurrente' : ''}{g.extraordinario ? ' · Extraordinario' : ''}
                            {g.archivo_path ? <a href={supabase.storage.from('archivos').getPublicUrl(g.archivo_path).data.publicUrl} target="_blank" rel="noopener" className="text-teal-600 font-medium ml-2">📄 factura</a>
                              : <label className="text-teal-600 cursor-pointer hover:underline ml-2">adjuntar factura<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) adjuntarFactura(g, f); }} /></label>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-slate-800">{fmtMoney(Number(g.monto))}</p>
                          <p className="text-[10px] text-slate-400">{['A', 'B', 'C', 'D'].filter((k) => Number(g[`monto_${k.toLowerCase()}` as keyof Gasto]) > 0).map((k) => `${k} ${fmtMoney(Number(g[`monto_${k.toLowerCase()}` as keyof Gasto]))}`).join(' · ') || g.categoria}</p>
                        </div>
                        {abierta && <div className="flex gap-0.5 shrink-0">
                          <button onClick={() => { setGastoEdit(g); setRubroNuevo(null); setGastoModal(true); }} title="Editar" className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                          <button onClick={() => quitarGasto(g)} title="Quitar del período" className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                        </div>}
                      </div>
                    ))}
                    {items.length > 0 && <div className="flex justify-end px-4 py-1.5 border-t border-slate-200 bg-slate-50 rounded-b-lg text-xs text-slate-600">Total categoría: <b className="ml-1 text-slate-800">{fmtMoney(sub)}</b></div>}
                  </div>
                );
              });
            })()}
          </div>
        </Card>
      ) : tab === 'cupones' ? (
        <Card>
          {cupones.length > 0 && <div className="flex flex-wrap items-center gap-2 px-4 pt-4 text-xs">
            <span className="text-slate-500 font-medium">Registro de cobranza:</span>
            {([['todos', 'Mostrar todos'], ['pendientes', 'Solo pendientes'], ['pagados', 'Solo pagos']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFiltroCob(k)} className={`rounded-full px-3 py-1 border ${filtroCob === k ? 'bg-[#1e2a4a] text-white border-[#1e2a4a]' : 'bg-white text-slate-600 border-slate-200'}`}>{l}</button>
            ))}
            <span className="ml-auto text-slate-500">{cupones.filter((c) => c.estado === 'pagado').length} pagados · {cupones.filter((c) => c.estado === 'parcial').length} parciales · {cupones.filter((c) => c.estado === 'pendiente').length} pendientes</span>
          </div>}
          {cupones.length === 0 ? (
            <EmptyState icon={<Receipt size={28} />} title="Todavía no se generaron cupones" subtitle='Cargá los gastos y usá "Generar cupones" o "Cerrar período".' />
          ) : (
            <Table headers={['UF', 'Depto / Propietario', 'A', 'B', 'C', 'D', 'Saldo ant.', 'Intereses', 'Total 1º venc.', 'Total 2º venc.', 'Estado', '']}>
              {cupones.filter((c) => filtroCob === 'todos' || (filtroCob === 'pagados' ? c.estado === 'pagado' : c.estado !== 'pagado')).map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{String(c.unidades?.uf ?? '').padStart(3, '0')}</Td>
                  <Td><span className="font-medium">{c.unidades?.depto}</span><span className="text-slate-400 text-xs block">{c.unidades?.propietario}</span></Td>
                  <Td className="text-xs">{fmtMoney(Number(c.monto_a))}</Td>
                  <Td className="text-xs">{fmtMoney(Number(c.monto_b))}</Td>
                  <Td className="text-xs">{fmtMoney(Number(c.monto_c))}</Td>
                  <Td className="text-xs">{fmtMoney(Number(c.monto_d))}</Td>
                  <Td className={`text-xs ${Number(c.saldo_anterior) > 0 ? 'text-red-500' : Number(c.saldo_anterior) < 0 ? 'text-emerald-600' : ''}`}>{fmtMoney(Number(c.saldo_anterior))}</Td>
                  <Td className="text-xs">{fmtMoney(Number(c.intereses))}</Td>
                  <Td className="font-semibold">{fmtMoney(Number(c.total))}</Td>
                  <Td className="text-slate-500">{fmtMoney(Number(c.total_2do_venc))}</Td>
                  <Td><Badge color={c.estado === 'pagado' ? 'green' : c.estado === 'parcial' ? 'amber' : 'slate'}>{c.estado}</Badge></Td>
                  <Td>{!abierta && c.estado !== 'pagado' && <Button size="sm" variant="secondary" onClick={() => abrirPago(c)}>Cobrar</Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ) : tab === 'envios' ? (
        <EnvioExpensas liq={liq} cupones={cupones} consorcioNombre={consorcio?.nombre || ''} onChange={loadAll} />
      ) : (
        <Card>
          {pagos.length === 0 ? (
            <EmptyState icon={<CheckCircle2 size={28} />} title="Sin cobranzas registradas" subtitle="Registrá los pagos desde la pestaña Cupones (botón Cobrar)." />
          ) : (
            <Table headers={['Fecha', 'UF', 'Propietario', 'Método', 'Comprobante', 'Monto', 'Registró', '']}>
              {pagos.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>{fmtDate(p.fecha)}</Td>
                  <Td className="font-mono text-xs">{String(p.unidades?.uf ?? '').padStart(3, '0')}</Td>
                  <Td>{p.unidades?.propietario || p.unidades?.depto}</Td>
                  <Td className="capitalize">{p.metodo}</Td>
                  <Td className="text-slate-400 text-xs">{p.comprobante || '—'}</Td>
                  <Td className="font-semibold text-emerald-600">{fmtMoney(Number(p.monto))}</Td>
                  <Td className="text-slate-400 text-xs">{p.registrado_por || '—'}</Td>
                  <Td><button onClick={() => borrarPago(p)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* Modal nuevo gasto */}
      <GastoModal open={gastoModal} onClose={() => { setGastoModal(false); setGastoEdit(null); }}
        consorcioId={liq.consorcio_id} liquidacionId={liq.id} onSaved={loadAll} gasto={gastoEdit} rubroInicial={rubroNuevo} />

      {/* Modal cobrar cupón */}
      <Modal open={!!pagoModal} onClose={() => setPagoModal(null)} title={`Cobrar UF ${pagoModal?.unidades?.uf} · ${pagoModal?.unidades?.depto}`}>
        {pagoModal && (
          <>
            <div className="bg-slate-50 rounded-lg p-3 text-sm mb-4 space-y-1">
              <p className="flex justify-between"><span className="text-slate-500">Total 1º vencimiento</span><b>{fmtMoney(Number(pagoModal.total))}</b></p>
              <p className="flex justify-between"><span className="text-slate-500">Total 2º vencimiento</span><b>{fmtMoney(Number(pagoModal.total_2do_venc))}</b></p>
              <p className="flex justify-between"><span className="text-slate-500">Ya cobrado</span><b className="text-emerald-600">{fmtMoney(pagos.filter((p) => p.cupon_id === pagoModal.id).reduce((a, p) => a + Number(p.monto), 0))}</b></p>
              <p className="text-xs text-slate-400 pt-1">Hoy corresponde: {fmtMoney(montoEsperado(pagoModal, liq.fecha_vencimiento_1, liq.fecha_vencimiento_2).monto)} ({montoEsperado(pagoModal, liq.fecha_vencimiento_1, liq.fecha_vencimiento_2).vencimiento})</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Fecha" type="date" value={pagoForm.fecha} onChange={(v) => setPagoForm({ ...pagoForm, fecha: v })} />
              <Input label="Monto" type="number" step="0.01" value={pagoForm.monto} onChange={(v) => setPagoForm({ ...pagoForm, monto: v })} required />
              <Select label="Método" value={pagoForm.metodo} onChange={(v) => setPagoForm({ ...pagoForm, metodo: v })}
                options={[{ value: 'transferencia', label: 'Transferencia' }, { value: 'efectivo', label: 'Efectivo' }, { value: 'cheque', label: 'Cheque' }, { value: 'debito', label: 'Débito' }, { value: 'tarjeta', label: 'Tarjeta' }]} />
              <Input label="Comprobante" value={pagoForm.comprobante} onChange={(v) => setPagoForm({ ...pagoForm, comprobante: v })} />
            </div>
            <div className="mt-4"><Textarea label="Observaciones" value={pagoForm.observaciones} onChange={(v) => setPagoForm({ ...pagoForm, observaciones: v })} rows={2} /></div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" onClick={() => setPagoModal(null)}>Cancelar</Button>
              <Button onClick={guardarPago} disabled={busy}>Registrar pago</Button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog open={!!confirm} title={confirm?.title || ''} message={confirm?.message || ''}
        peligro={/eliminar/i.test(confirm?.title || '')} confirmLabel={/eliminar/i.test(confirm?.title || '') ? 'Eliminar' : 'Confirmar'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const a = confirm?.action; setConfirm(null); if (a) run(a); }} />
    </div>
  );
}

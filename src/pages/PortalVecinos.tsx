import { useEffect, useState } from 'react';
import { Eye, Plus, Save, Smartphone, Trash2, Pencil } from 'lucide-react';
import { supabase, SUPABASE_URL, type Administracion, type Consorcio, type Telefono, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Td, Tabs, Textarea } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Ayuda } from '@/components/Ayuda';
import { PORTAL_URL } from '@/lib/config';
import { fmtDate, fmtMoney, periodoLabel } from '@/lib/engine';

/*
  Portal de vecinos (lado administración):
  - Ver como vecino: elegís un mail y ves exactamente lo que le muestra el portal en el celular (misma función del backend).
  - Datos útiles: textos que aparecen en la pestaña "Info útil" del portal (generales o por consorcio), horario de la administración,
    y qué teléfonos de la agenda se publican.
  - Dispositivos: quiénes activaron las notificaciones.
*/

type PortalInfo = { id: string; consorcio_id: string | null; titulo: string; contenido: string; orden: number; activo: boolean; consorcios?: { nombre: string } | null };
type Datos = {
  email: string; dispositivos: number;
  administracion: { nombre: string; telefono: string | null; email: string | null; direccion: string | null; horario_atencion: string | null } | null;
  unidades: { id: string; uf: number; depto: string; consorcio: string; rol: string; nombre: string | null; expensa: { periodo: string; vencimiento_1: string | null; vencimiento_2: string | null; pdf_url: string | null; cupon: { total: number; total_2do_venc: number; saldo_anterior: number; intereses: number; estado: string } | null } | null; pagos: { fecha: string; monto: number; metodo: string }[] }[];
  comunicados: { id: string; titulo: string; contenido: string; fecha_publicacion: string; consorcio: string; adjunto_url: string | null }[];
  info: { titulo: string; contenido: string; consorcio: string | null }[];
  telefonos: { nombre: string; categoria: string; telefono: string; notas: string | null; consorcio: string | null }[];
};

export function PortalVecinos() {
  const { consorcios, consorcio } = useApp();
  const [tab, setTab] = useState('ver');
  const [unidades, setUnidades] = useState<(Unidad & { consorcios: { nombre: string } | null })[]>([]);
  const [email, setEmail] = useState('');
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [tabPortal, setTabPortal] = useState<'expensas' | 'comunicados' | 'info'>('expensas');

  const [infos, setInfos] = useState<PortalInfo[]>([]);
  const [telefonos, setTelefonos] = useState<(Telefono & { visible_portal: boolean; consorcios: { nombre: string } | null })[]>([]);
  const [admin, setAdmin] = useState<Administracion | null>(null);
  const [adminForm, setAdminForm] = useState({ telefono: '', email: '', direccion: '', horario_atencion: '' });
  const [infoModal, setInfoModal] = useState(false);
  const [infoEdit, setInfoEdit] = useState<PortalInfo | null>(null);
  const [infoForm, setInfoForm] = useState({ consorcio_id: '', titulo: '', contenido: '', orden: '0', activo: true });
  const [borrar, setBorrar] = useState<PortalInfo | null>(null);
  const [conApp, setConApp] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [u, i, t, a, p] = await Promise.all([
      supabase.from('unidades').select('*, consorcios(nombre)').eq('activo', true).order('uf'),
      supabase.from('portal_info').select('*, consorcios(nombre)').order('orden').order('created_at'),
      supabase.from('telefonos').select('*, consorcios(nombre)').order('categoria').order('nombre'),
      supabase.from('administracion').select('*').limit(1).maybeSingle(),
      supabase.from('push_emails').select('email'),
    ]);
    setUnidades((u.data as typeof unidades) || []);
    setInfos((i.data as PortalInfo[]) || []);
    setTelefonos((t.data as typeof telefonos) || []);
    const ad = a.data as typeof admin;
    setAdmin(ad);
    if (ad) setAdminForm({ telefono: ad.telefono || '', email: ad.email || '', direccion: ad.direccion || '', horario_atencion: ad.horario_atencion || '' });
    setConApp(((p.data as { email: string }[]) || []).map((x) => x.email));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Mails distintos con unidad (filtrados por el consorcio activo si hay)
  const opcionesMail = (() => {
    const m = new Map<string, string>();
    for (const u of unidades) {
      if (consorcio && u.consorcio_id !== consorcio.id) continue;
      for (const [e, n] of [[u.propietario_email, u.propietario], [u.alquilada ? u.inquilino_email : null, u.inquilino]] as [string | null, string | null][]) {
        if (e) { const k = e.trim().toLowerCase(); if (!m.has(k)) m.set(k, `${k} · ${n || ''} · UF ${u.uf} ${u.consorcios?.nombre || ''}`); }
      }
    }
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  })();

  const verComo = async () => {
    if (!email) return;
    setCargando(true); setError(''); setDatos(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/portal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string },
        body: JSON.stringify({ accion: 'ver-como', email }),
      });
      const d = await resp.json();
      if (!resp.ok || d.error) throw new Error(d.error || `Error ${resp.status}`);
      setDatos(d as Datos); setTabPortal('expensas');
    } catch (e) { setError((e as Error).message.includes('desconocida') ? 'La función "portal" de Supabase está desactualizada: volvé a subir la última versión.' : (e as Error).message); }
    setCargando(false);
  };

  const guardarAdmin = async () => {
    if (!admin) return;
    const { error: err } = await supabase.from('administracion').update({ telefono: adminForm.telefono || null, email: adminForm.email || null, direccion: adminForm.direccion || null, horario_atencion: adminForm.horario_atencion || null }).eq('id', admin.id);
    setMsg(err ? `Error: ${err.message}` : 'Datos de la administración guardados.'); load();
  };
  const guardarInfo = async () => {
    if (!infoForm.titulo.trim() || !infoForm.contenido.trim()) { setMsg('Error: completá título y contenido.'); return; }
    const payload = { consorcio_id: infoForm.consorcio_id || null, titulo: infoForm.titulo.trim(), contenido: infoForm.contenido.trim(), orden: parseInt(infoForm.orden) || 0, activo: infoForm.activo };
    const { error: err } = infoEdit ? await supabase.from('portal_info').update(payload).eq('id', infoEdit.id) : await supabase.from('portal_info').insert(payload);
    setMsg(err ? `Error: ${err.message}` : 'Guardado. Los vecinos lo ven al abrir el portal.'); setInfoModal(false); load();
  };
  const toggleTel = async (t: Telefono & { visible_portal: boolean }) => { await supabase.from('telefonos').update({ visible_portal: !t.visible_portal }).eq('id', t.id); load(); };

  const fecha = (d: string | null) => (d ? fmtDate(d) : '—');

  return (
    <div>
      <PageHeader title="Portal de vecinos" subtitle={`Lo que ven los propietarios e inquilinos en ${PORTAL_URL}`} action={
        tab === 'datos' ? <Button onClick={() => { setInfoEdit(null); setInfoForm({ consorcio_id: consorcio?.id || '', titulo: '', contenido: '', orden: String(infos.length + 1), activo: true }); setInfoModal(true); }}><Plus size={16} /> Nuevo dato útil</Button> : null
      } />
      {msg && <div className={`text-sm rounded-lg px-4 py-2.5 mb-4 ${msg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg} <button className="ml-2 underline" onClick={() => setMsg('')}>cerrar</button></div>}
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'ver', label: 'Ver como vecino' }, { key: 'datos', label: 'Datos útiles', badge: infos.filter((i) => i.activo).length }, { key: 'app', label: 'Con la app instalada', badge: conApp.length }]} />

      {loading ? <Spinner /> : tab === 'ver' ? (
        <>
          <Ayuda id="portal_ver" titulo="Para qué sirve">
            <p>Elegí el mail de un vecino y ves exactamente lo que le muestra el portal (expensa, PDF, comunicados, info útil), con los mismos datos que recibe él. Sirve para responder "no me figura la expensa" sin pedirle capturas. Si no aparece en la lista, es porque su mail no está cargado en Unidades.</p>
          </Ayuda>
          <Card className="mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-72"><Select label={`Vecino${consorcio ? ` (${consorcio.nombre})` : ''}`} value={email} onChange={setEmail} placeholder="— Elegir mail —" options={opcionesMail} /></div>
              <Button onClick={verComo} disabled={!email || cargando}><Eye size={15} /> {cargando ? 'Cargando…' : 'Ver su portal'}</Button>
              {email && <span className="text-xs text-slate-500 flex items-center gap-1 pb-2">{conApp.includes(email) ? <><Smartphone size={13} className="text-teal-600" /> tiene la app con avisos</> : 'sin la app'}</span>}
            </div>
            {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
          </Card>
          {datos && (
            <div className="mx-auto w-[390px] max-w-full rounded-[28px] border-8 border-slate-800 bg-slate-100 overflow-hidden shadow-xl text-[13px]">
              <div className="bg-teal-500 text-white px-4 py-3 flex items-center gap-2"><div className="w-7 h-7 rounded-lg bg-white/20" /><div><div className="font-bold">Grupo Amel</div><div className="text-[10px] opacity-90">{datos.email}</div></div></div>
              <div className="flex gap-1.5 p-3 pb-0">
                {(['expensas', 'comunicados', 'info'] as const).map((t) => <button key={t} onClick={() => setTabPortal(t)} className={`flex-1 rounded-lg py-2 text-xs font-semibold border ${tabPortal === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>{t === 'info' ? 'Info útil' : t[0].toUpperCase() + t.slice(1)}</button>)}
              </div>
              <div className="p-3 space-y-3 max-h-[600px] overflow-y-auto">
                {tabPortal === 'expensas' && datos.unidades.map((u) => {
                  const e = u.expensa, c = e?.cupon;
                  return (
                    <div key={u.id} className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="font-bold text-slate-800">{u.consorcio}</div>
                      <div className="text-slate-500 text-xs">UF {u.uf} · {u.depto} · {u.rol === 'propietario' ? 'Propietario/a' : 'Inquilino/a'}{u.nombre ? ` · ${u.nombre}` : ''}</div>
                      {e ? <>
                        <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-3 mb-1">Expensas {periodoLabel(e.periodo)} {c && <Badge color={c.estado === 'pagado' ? 'green' : c.estado === 'parcial' ? 'amber' : 'red'}>{c.estado === 'pagado' ? 'Pagada' : c.estado === 'parcial' ? 'Pago parcial' : 'Pendiente'}</Badge>}</div>
                        {c ? <>
                          <div className="text-2xl font-extrabold text-slate-800">{fmtMoney(Number(c.total))}</div>
                          <div className="text-xs text-slate-500">hasta el {fecha(e.vencimiento_1)}{e.vencimiento_2 && Number(c.total_2do_venc) !== Number(c.total) ? ` · ${fmtMoney(Number(c.total_2do_venc))} hasta el ${fecha(e.vencimiento_2)}` : ''}</div>
                          {Number(c.saldo_anterior) !== 0 && <div className="flex justify-between text-xs mt-1"><span className="text-slate-500">Saldo anterior</span><b className={Number(c.saldo_anterior) > 0 ? 'text-red-500' : 'text-emerald-600'}>{fmtMoney(Number(c.saldo_anterior))}</b></div>}
                        </> : <p className="text-slate-500 text-xs">Tu cupón todavía no está disponible.</p>}
                        {e.pdf_url ? <a href={e.pdf_url} target="_blank" rel="noopener" className="block text-center bg-teal-500 text-white rounded-lg py-2 mt-3 font-semibold text-xs">Ver liquidación (PDF)</a> : <p className="text-[11px] text-amber-700 mt-2">Sin PDF adjunto: no ve el botón de la liquidación.</p>}
                      </> : <p className="text-slate-500 text-xs mt-2">Todavía no hay expensas publicadas.</p>}
                      {u.pagos.length > 0 && <><div className="text-[10px] uppercase tracking-wide text-slate-400 mt-3 mb-1">Últimos pagos</div>{u.pagos.map((p, i) => <div key={i} className="flex justify-between text-xs py-1 border-t border-slate-100"><span className="text-slate-500">{fmtDate(p.fecha)} · {p.metodo}</span><b>{fmtMoney(Number(p.monto))}</b></div>)}</>}
                    </div>
                  );
                })}
                {tabPortal === 'comunicados' && (datos.comunicados.length === 0 ? <div className="bg-white rounded-xl border p-4 text-center text-slate-400">No hay comunicados por ahora.</div> : <div className="bg-white rounded-xl border border-slate-200 p-3 divide-y divide-slate-100">{datos.comunicados.map((c) => <div key={c.id} className="py-2"><div className="font-bold text-slate-800">{c.titulo}</div><div className="text-[11px] text-slate-400">{fmtDate(c.fecha_publicacion)} · {c.consorcio}</div><div className="whitespace-pre-wrap text-slate-700 mt-1">{c.contenido}</div>{c.adjunto_url && <a href={c.adjunto_url} target="_blank" rel="noopener" className="text-teal-600 text-xs font-semibold">Ver adjunto</a>}</div>)}</div>)}
                {tabPortal === 'info' && <>
                  <div className="bg-white rounded-xl border border-slate-200 p-3"><div className="font-bold text-slate-800">{datos.administracion?.nombre}</div>
                    {[['Teléfono', datos.administracion?.telefono], ['Mail', datos.administracion?.email], ['Dirección', datos.administracion?.direccion], ['Atención', datos.administracion?.horario_atencion]].filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between text-xs py-1 border-t border-slate-100"><span className="text-slate-500">{k}</span><span>{v}</span></div>)}</div>
                  {datos.info.map((i, k) => <div key={k} className="bg-white rounded-xl border border-slate-200 p-3"><div className="font-bold text-slate-800">{i.titulo}</div>{i.consorcio && <div className="text-[11px] text-slate-400">{i.consorcio}</div>}<div className="whitespace-pre-wrap text-slate-700 mt-1">{i.contenido}</div></div>)}
                  {datos.telefonos.length > 0 && <div className="bg-white rounded-xl border border-slate-200 p-3"><div className="font-bold text-slate-800 mb-1">Teléfonos útiles</div>{datos.telefonos.map((t, k) => <div key={k} className="flex justify-between items-center text-xs py-1.5 border-t border-slate-100"><div><b>{t.nombre}</b>{t.consorcio && <div className="text-slate-400">{t.consorcio}</div>}</div><span className="bg-teal-500 text-white rounded-md px-2 py-1 font-semibold">{t.telefono}</span></div>)}</div>}
                  {datos.info.length === 0 && datos.telefonos.length === 0 && <p className="text-center text-slate-400 text-xs">Todavía no cargaste datos útiles ni teléfonos visibles.</p>}
                </>}
              </div>
            </div>
          )}
        </>
      ) : tab === 'datos' ? (
        <>
          <Ayuda id="portal_datos" titulo="Qué va acá">
            <p>Todo lo que un vecino pregunta seguido y no cambia: horario del encargado, cómo pagar las expensas (CBU/alias), qué hacer ante una pérdida de agua, reglamento de uso del SUM o la terraza, día de retiro de residuos. Un dato puede ser para todos los consorcios o para uno solo. Los teléfonos salen de la agenda (Teléfonos): acá elegís cuáles se publican.</p>
          </Ayuda>
          <Card className="mb-4">
            <h3 className="font-semibold text-slate-700 mb-3">Administración (encabezado de Info útil)</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <Input label="Teléfono" value={adminForm.telefono} onChange={(v) => setAdminForm({ ...adminForm, telefono: v })} />
              <Input label="Mail" value={adminForm.email} onChange={(v) => setAdminForm({ ...adminForm, email: v })} />
              <Input label="Dirección" value={adminForm.direccion} onChange={(v) => setAdminForm({ ...adminForm, direccion: v })} />
              <Input label="Horario de atención" value={adminForm.horario_atencion} onChange={(v) => setAdminForm({ ...adminForm, horario_atencion: v })} placeholder="Lun a vie 10 a 17" />
              <Button variant="secondary" onClick={guardarAdmin}><Save size={15} /> Guardar</Button>
            </div>
          </Card>
          <Card className="mb-4">
            <h3 className="font-semibold text-slate-700 mb-3">Datos útiles</h3>
            <Table headers={['Orden', 'Título', 'Para', 'Contenido', 'Estado', '']}>
              {infos.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <Td>{i.orden}</Td><Td className="font-medium">{i.titulo}</Td><Td className="text-slate-500">{i.consorcios?.nombre || 'Todos'}</Td>
                  <Td className="max-w-md truncate text-slate-500">{i.contenido}</Td>
                  <Td><Badge color={i.activo ? 'green' : 'slate'}>{i.activo ? 'visible' : 'oculto'}</Badge></Td>
                  <Td><div className="flex gap-1">
                    <button onClick={() => { setInfoEdit(i); setInfoForm({ consorcio_id: i.consorcio_id || '', titulo: i.titulo, contenido: i.contenido, orden: String(i.orden), activo: i.activo }); setInfoModal(true); }} className="p-1.5 rounded text-teal-600 hover:bg-teal-50"><Pencil size={14} /></button>
                    <button onClick={() => setBorrar(i)} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div></Td>
                </tr>
              ))}
              {infos.length === 0 && <tr><Td colSpan={6} className="text-center text-slate-400 py-8">Sin datos cargados. Ejemplos: "Cómo pagar las expensas", "Horario del encargado", "Uso del SUM".</Td></tr>}
            </Table>
          </Card>
          <Card>
            <h3 className="font-semibold text-slate-700 mb-1">Teléfonos publicados en el portal</h3>
            <p className="text-xs text-slate-400 mb-3">Se cargan en Teléfonos; acá tildás cuáles ve el vecino (los de proveedores suelen quedar ocultos).</p>
            <Table headers={['Visible', 'Nombre', 'Categoría', 'Teléfono', 'Consorcio']}>
              {telefonos.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <Td><input type="checkbox" className="rounded" checked={t.visible_portal} onChange={() => toggleTel(t)} /></Td>
                  <Td className="font-medium">{t.nombre}</Td><Td className="capitalize text-slate-500">{t.categoria}</Td><Td>{t.telefono}</Td><Td className="text-slate-500">{t.consorcios?.nombre || 'Todos'}</Td>
                </tr>
              ))}
              {telefonos.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-400 py-6">La agenda está vacía (menú Teléfonos).</Td></tr>}
            </Table>
          </Card>
        </>
      ) : (
        <Card>
          {conApp.length === 0 ? <EmptyState icon={<Smartphone size={28} />} title="Nadie activó las notificaciones todavía" subtitle="Cuando un vecino entra al portal y toca 'Activar notificaciones', aparece acá y en Unidades con el 📱." /> : (
            <Table headers={['Mail', 'Unidades']}>
              {conApp.map((e) => <tr key={e} className="hover:bg-slate-50"><Td className="font-medium">{e}</Td><Td className="text-slate-500">{unidades.filter((u) => (u.propietario_email || '').toLowerCase() === e || (u.inquilino_email || '').toLowerCase() === e).map((u) => `UF ${u.uf} ${u.consorcios?.nombre || ''}`).join(' · ') || '—'}</Td></tr>)}
            </Table>
          )}
        </Card>
      )}

      <Modal open={infoModal} onClose={() => setInfoModal(false)} title={infoEdit ? 'Editar dato útil' : 'Nuevo dato útil'}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Input label="Título" value={infoForm.titulo} onChange={(v) => setInfoForm({ ...infoForm, titulo: v })} placeholder="Cómo pagar las expensas" required /></div>
          <div className="col-span-2"><Textarea label="Contenido" value={infoForm.contenido} onChange={(v) => setInfoForm({ ...infoForm, contenido: v })} rows={5} placeholder={'Transferencia al CBU 000… (alias AMEL.CONSORCIO).\nEnviar el comprobante a expensas@…'} /></div>
          <Select label="Para" value={infoForm.consorcio_id} onChange={(v) => setInfoForm({ ...infoForm, consorcio_id: v })} placeholder="Todos los consorcios" options={consorcios.map((c: Consorcio) => ({ value: c.id, label: c.nombre }))} />
          <Input label="Orden" type="number" value={infoForm.orden} onChange={(v) => setInfoForm({ ...infoForm, orden: v })} />
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="rounded" checked={infoForm.activo} onChange={(e) => setInfoForm({ ...infoForm, activo: e.target.checked })} /> Visible en el portal</label>
        </div>
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setInfoModal(false)}>Cancelar</Button><Button onClick={guardarInfo}>Guardar</Button></div>
      </Modal>
      <ConfirmDialog open={!!borrar} title="Eliminar dato útil" message={`¿Eliminar "${borrar?.titulo}"?`} onCancel={() => setBorrar(null)}
        onConfirm={async () => { if (borrar) await supabase.from('portal_info').delete().eq('id', borrar.id); setBorrar(null); load(); }} />
    </div>
  );
}

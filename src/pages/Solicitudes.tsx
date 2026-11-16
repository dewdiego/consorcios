import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, X } from 'lucide-react';
import { supabase, type Unidad } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';
import { fmtDate } from '@/lib/engine';
import { mailHtml, ufTxt } from '@/lib/avisos';
import { PORTAL_URL } from '@/lib/config';

type Solicitud = { id: string; consorcio_id: string; email: string; nombre: string | null; comentario: string | null; estado: 'pendiente' | 'aprobada' | 'rechazada'; unidad_id: string | null; rol: string | null; created_at: string };
const nuevoCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

/** Pedidos de acceso al portal: el vecino que no figura con su mail lo pide con el código del edificio y acá se lo asigna a su unidad. */
export function Solicitudes() {
  const { consorcio, reloadConsorcios } = useApp();
  const [items, setItems] = useState<Solicitud[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [aprobar, setAprobar] = useState<Solicitud | null>(null);
  const [f, setF] = useState({ unidad_id: '', rol: 'propietario' });

  const load = async () => {
    if (!consorcio) return;
    setLoading(true);
    const [s, u, c] = await Promise.all([
      supabase.from('solicitudes_acceso').select('*').eq('consorcio_id', consorcio.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('unidades').select('*').eq('consorcio_id', consorcio.id).eq('activo', true).order('uf'),
      supabase.from('consorcios').select('codigo_acceso').eq('id', consorcio.id).maybeSingle(),
    ]);
    setItems((s.data as Solicitud[]) || []); setUnidades((u.data as Unidad[]) || []); setCodigo((c.data as { codigo_acceso: string | null } | null)?.codigo_acceso || null); setLoading(false);
  };
  useEffect(() => { load(); }, [consorcio?.id]);

  const generar = async () => {
    if (!consorcio) return;
    const { error } = await supabase.from('consorcios').update({ codigo_acceso: nuevoCodigo() }).eq('id', consorcio.id);
    if (error) return setMsg(error.message);
    await reloadConsorcios(); load();
  };
  const u = unidades.find((x) => x.id === f.unidad_id);
  const ocupado = u ? (f.rol === 'propietario' ? u.propietario_email : u.inquilino_email) : null;
  const confirmar = async () => {
    const s = aprobar; if (!s || !consorcio || !u) return setMsg('Elegí la unidad.');
    const cambio = f.rol === 'propietario' ? { propietario_email: s.email, ...(u.propietario ? {} : { propietario: s.nombre }) } : { inquilino_email: s.email, alquilada: true, ...(u.inquilino ? {} : { inquilino: s.nombre }) };
    const { error } = await supabase.from('unidades').update(cambio).eq('id', u.id);
    if (error) return setMsg(error.message);
    await supabase.from('solicitudes_acceso').update({ estado: 'aprobada', unidad_id: u.id, rol: f.rol }).eq('id', s.id);
    await supabase.from('cola_envios').insert({ consorcio_id: consorcio.id, unidad_id: u.id, email: s.email, nombre: s.nombre, canal: 'mail', asunto: `Ya podés ingresar al portal - ${consorcio.nombre}`,
      html: mailHtml('Tu acceso fue aprobado', `${consorcio.nombre} · ${ufTxt(u)}`, '<p>Ya podés entrar al portal con este mismo mail: te llega un código para ingresar, no hace falta contraseña.</p>', { texto: 'Entrar al portal', url: PORTAL_URL }) });
    setAprobar(null); setMsg(`Acceso aprobado: ${s.email} quedó como ${f.rol} de ${ufTxt(u)}. Se le avisa por mail.`); load();
  };
  const rechazar = async (s: Solicitud) => { await supabase.from('solicitudes_acceso').update({ estado: 'rechazada' }).eq('id', s.id); load(); };

  if (!consorcio) return null;
  const pend = items.filter((s) => s.estado === 'pendiente');
  return (
    <div>
      <PageHeader title={`Pedidos de acceso · ${consorcio.nombre}`} subtitle="Vecinos que piden entrar al portal con el código del edificio" />
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <KeyRound size={18} className="text-teal-600" />
          <span className="text-sm text-slate-600">Código del edificio:</span>
          {codigo ? <b className="text-lg tracking-widest text-slate-800">{codigo}</b> : <span className="text-sm text-slate-400">todavía no tiene</span>}
          {codigo && <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(codigo); setMsg('Código copiado.'); }}><Copy size={13} /> Copiar</Button>}
          <Button size="sm" variant="secondary" onClick={generar}><RefreshCw size={13} /> {codigo ? 'Cambiar' : 'Generar'}</Button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Pasale este código a los vecinos (cartelera, mail, WhatsApp). En el portal tocan "Pedir acceso", lo escriben con su depto y vos lo aprobás acá. Quien ya tiene su mail cargado en la unidad entra directo, sin código.</p>
      </Card>
      {msg && <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 mb-4">{msg}</p>}
      {loading ? <Spinner /> : items.length === 0 ? <Card><EmptyState icon={<KeyRound size={28} />} title="Sin pedidos" subtitle="Cuando un vecino pida acceso con el código, aparece acá." /></Card> : (
        <Card><Table headers={['Fecha', 'Mail', 'Nombre', 'Comentario (depto / lote)', 'Estado', '']}>
          {items.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50">
              <Td>{fmtDate(s.created_at)}</Td><Td className="font-medium">{s.email}</Td><Td>{s.nombre || '—'}</Td><Td className="text-slate-500">{s.comentario || '—'}</Td>
              <Td><Badge color={s.estado === 'pendiente' ? 'amber' : s.estado === 'aprobada' ? 'green' : 'slate'}>{s.estado.toUpperCase()}</Badge>{s.unidad_id && <span className="block text-xs text-slate-400">{ufTxt(unidades.find((x) => x.id === s.unidad_id))} · {s.rol}</span>}</Td>
              <Td>{s.estado === 'pendiente' && <div className="flex gap-1"><Button size="sm" onClick={() => { setMsg(''); setF({ unidad_id: '', rol: 'propietario' }); setAprobar(s); }}><Check size={13} /> Aprobar</Button><Button size="sm" variant="secondary" onClick={() => rechazar(s)}><X size={13} /> Rechazar</Button></div>}</Td>
            </tr>
          ))}
        </Table></Card>
      )}
      {pend.length > 0 && <p className="text-xs text-slate-400 mt-2">{pend.length} pendiente(s).</p>}
      <Modal open={!!aprobar} onClose={() => setAprobar(null)} title="Aprobar acceso">
        {aprobar && <>
          <p className="text-sm text-slate-600 mb-3"><b>{aprobar.email}</b>{aprobar.nombre ? ` · ${aprobar.nombre}` : ''}{aprobar.comentario ? ` · dice: "${aprobar.comentario}"` : ''}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Unidad" value={f.unidad_id} onChange={(v) => setF({ ...f, unidad_id: v })} placeholder="— Elegir —" options={unidades.map((x) => ({ value: x.id, label: `${ufTxt(x)} · ${x.propietario || ''}` }))} />
            <Select label="Entra como" value={f.rol} onChange={(v) => setF({ ...f, rol: v })} options={[{ value: 'propietario', label: 'Propietario' }, { value: 'inquilino', label: 'Inquilino' }]} />
          </div>
          {ocupado && ocupado.toLowerCase() !== aprobar.email.toLowerCase() && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">Esa unidad ya tiene cargado el mail <b>{ocupado}</b> como {f.rol}. Si aprobás, se reemplaza y esa persona deja de entrar.</p>}
          <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setAprobar(null)}>Cancelar</Button><Button onClick={confirmar} disabled={!f.unidad_id}>Aprobar</Button></div>
        </>}
      </Modal>
    </div>
  );
}

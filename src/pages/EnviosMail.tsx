import { useEffect, useState } from 'react';
import { Mail, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Table, Td } from '@/components/ui';

/*
  Log de envíos de mail (expensas y comunicados) + herramientas de diagnóstico:
  - Procesar ahora: corre la función y muestra su respuesta completa.
  - Probar envío: manda un mail directo a una casilla y muestra la respuesta cruda de Resend.
*/

type Fila = {
  id: string; created_at: string; consorcio_id: string; email: string; nombre: string | null; asunto: string;
  estado: 'pendiente' | 'enviando' | 'enviado' | 'error'; intentos: number; error: string | null;
  enviado_at: string | null; enviar_desde: string | null; resend_id: string | null;
  liquidacion_id: string | null; comunicado_id: string | null; canal: 'mail' | 'push';
};
const estadoColor = { pendiente: 'amber', enviando: 'blue', enviado: 'green', error: 'red' } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function EnviosMail() {
  const { consorcios } = useApp();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [loading, setLoading] = useState(true);
  const [fEstado, setFEstado] = useState('');
  const [fConsorcio, setFConsorcio] = useState('');
  const [busy, setBusy] = useState(false);
  const [salida, setSalida] = useState<string>('');
  const [testEmail, setTestEmail] = useState('');

  const load = async () => {
    setLoading(true);
    let q = supabase.from('cola_envios').select('*').order('created_at', { ascending: false }).limit(500);
    if (fEstado) q = q.eq('estado', fEstado);
    if (fConsorcio) q = q.eq('consorcio_id', fConsorcio);
    const { data } = await q;
    setFilas((data as Fila[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [fEstado, fConsorcio]);

  const invocar = async (body: Record<string, unknown>, titulo: string) => {
    setBusy(true);
    setSalida(`${titulo}…`);
    const { data, error } = await supabase.functions.invoke('enviar-expensas', { body });
    if (error) {
      let detalle = error.message;
      try { const ctx = (error as { context?: Response }).context; if (ctx) detalle += '\n' + (await ctx.text()); } catch { /* noop */ }
      setSalida(`${titulo}: NO SE PUDO LLAMAR A LA FUNCIÓN\n${detalle}\n\nRevisá: ¿está instalada la función "enviar-expensas" en Supabase → Edge Functions? ¿Tiene los secretos RESEND_API_KEY y RESEND_FROM?`);
    } else {
      setSalida(`${titulo}:\n${JSON.stringify(data, null, 2)}`);
    }
    setBusy(false);
    load();
  };

  const procesar = () => invocar({}, 'Procesar cola');
  const probar = () => {
    if (!testEmail.includes('@')) { setSalida('Ingresá una casilla válida para la prueba.'); return; }
    invocar({ test_email: testEmail.trim() }, `Prueba a ${testEmail.trim()}`);
  };
  const reintentar = async () => {
    setBusy(true);
    await supabase.from('cola_envios').update({ estado: 'pendiente', error: null }).eq('estado', 'error');
    setBusy(false);
    await invocar({}, 'Reintentar errores');
  };
  const borrarPendientes = async () => {
    if (!confirm('¿Eliminar todos los envíos pendientes y con error de la cola?')) return;
    await supabase.from('cola_envios').delete().in('estado', ['pendiente', 'error']);
    load();
  };

  const cuenta = (e: Fila['estado']) => filas.filter((f) => f.estado === e).length;
  const nombreC = (id: string) => consorcios.find((c) => c.id === id)?.nombre || '—';

  return (
    <div>
      <PageHeader title="Envíos de mail" subtitle="Log de la cola de envío (expensas y comunicados) y diagnóstico"
        action={<div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={procesar} disabled={busy}><RefreshCw size={15} /> Procesar ahora</Button>
          {cuenta('error') > 0 && <Button variant="secondary" onClick={reintentar} disabled={busy}><RotateCcw size={15} /> Reintentar errores</Button>}
        </div>} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <p className="text-sm font-semibold text-slate-700 mb-1">Probar envío</p>
          <p className="text-xs text-slate-400 mb-3">Manda un mail directo (sin cola) y muestra la respuesta exacta de Resend. Es la forma más rápida de saber por qué no llegan.</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Input type="email" value={testEmail} onChange={setTestEmail} placeholder="tu@mail.com" /></div>
            <Button onClick={probar} disabled={busy}><Send size={15} /> Probar</Button>
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-semibold text-slate-700 mb-1">Resultado</p>
          <pre className="text-[11px] leading-relaxed bg-slate-900 text-slate-100 rounded-lg p-3 overflow-auto max-h-56 whitespace-pre-wrap">{salida || 'Todavía no se ejecutó nada. Usá "Probar envío" o "Procesar ahora".'}</pre>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-44"><Select label="Estado" value={fEstado} onChange={setFEstado} placeholder="Todos"
            options={[{ value: 'pendiente', label: 'Pendiente' }, { value: 'enviando', label: 'Enviando' }, { value: 'enviado', label: 'Enviado' }, { value: 'error', label: 'Error' }]} /></div>
          <div className="w-56"><Select label="Consorcio" value={fConsorcio} onChange={setFConsorcio} placeholder="Todos"
            options={consorcios.map((c) => ({ value: c.id, label: c.nombre }))} /></div>
          <div className="flex items-center gap-2 text-xs pb-2.5">
            <Badge color="green">{cuenta('enviado')} enviados</Badge>
            <Badge color="amber">{cuenta('pendiente') + cuenta('enviando')} en cola</Badge>
            <Badge color="red">{cuenta('error')} con error</Badge>
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={13} /> Refrescar</Button>
          {(cuenta('pendiente') + cuenta('error')) > 0 && <Button variant="ghost" size="sm" onClick={borrarPendientes}><Trash2 size={13} /> Vaciar cola</Button>}
        </div>

        {loading ? <Spinner /> : filas.length === 0 ? (
          <EmptyState icon={<Mail size={28} />} title="No hay envíos registrados" subtitle="Los envíos de expensas y comunicados aparecen acá." />
        ) : (
          <Table headers={['Creado', 'Consorcio', 'Destinatario', 'Asunto', 'Tipo', 'Estado', 'Int.', 'Enviado', 'Detalle']}>
            {filas.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50">
                <Td className="text-xs whitespace-nowrap">{fmt(f.created_at)}</Td>
                <Td className="text-xs">{nombreC(f.consorcio_id)}</Td>
                <Td className="text-xs"><span className="block">{f.nombre || '—'}</span><span className="text-slate-400">{f.email}</span></Td>
                <Td className="text-xs max-w-[220px]"><span className="block truncate" title={f.asunto}>{f.asunto}</span></Td>
                <Td><Badge color={f.liquidacion_id ? 'teal' : 'purple'}>{f.liquidacion_id ? 'expensas' : 'comunicado'}</Badge><span className="block text-[10px] text-slate-400 mt-0.5">{f.canal === 'push' ? '📱 app' : '✉ mail'}</span></Td>
                <Td><Badge color={estadoColor[f.estado]}>{f.estado}</Badge>{f.enviar_desde && f.estado === 'pendiente' && <span className="block text-[10px] text-slate-400">desde {fmt(f.enviar_desde)}</span>}</Td>
                <Td className="text-xs text-center">{f.intentos}</Td>
                <Td className="text-xs whitespace-nowrap">{fmt(f.enviado_at)}</Td>
                <Td className="text-xs max-w-[260px]">
                  {f.error ? <span className="text-red-500 block whitespace-pre-wrap">{f.error}</span>
                    : f.resend_id ? <span className="text-slate-400 font-mono">{f.resend_id}</span> : ''}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

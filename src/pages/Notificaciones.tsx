import { useEffect, useState } from 'react';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { supabase, type Notificacion } from '@/lib/supabase';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { fmtDate } from '@/lib/engine';

export function Notificaciones() {
  const [items, setItems] = useState<Notificacion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('notificaciones').select('*').order('created_at', { ascending: false }).limit(200);
    setItems((data as Notificacion[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const marcarTodas = async () => {
    await supabase.from('notificaciones').update({ leida: true }).eq('leida', false);
    load();
  };

  const noLeidas = items.filter((n) => !n.leida).length;

  return (
    <div>
      <PageHeader title="Notificaciones" subtitle="Avisos internos del sistema: cierres, reclamos urgentes, vencimientos"
        action={noLeidas > 0 ? <Button variant="secondary" onClick={marcarTodas}><CheckCheck size={15} /> Marcar todas como leídas ({noLeidas})</Button> : undefined} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<Bell size={28} />} title="Sin notificaciones" /></Card>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n.id} className={`p-4 flex items-start gap-3 ${!n.leida ? 'border-teal-200 bg-teal-50/30' : ''}`}>
              <Badge color={n.tipo === 'alerta' ? 'red' : n.tipo === 'vencimiento' ? 'amber' : 'blue'}>{n.tipo}</Badge>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!n.leida ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{n.titulo}</p>
                {n.detalle && <p className="text-xs text-slate-400 mt-0.5">{n.detalle}</p>}
                <p className="text-[11px] text-slate-400 mt-1">{fmtDate(n.created_at.slice(0, 10))}</p>
              </div>
              {!n.leida && <button className="text-xs text-teal-600 font-medium hover:underline shrink-0"
                onClick={async () => { await supabase.from('notificaciones').update({ leida: true }).eq('id', n.id); load(); }}>Marcar leída</button>}
              <button onClick={async () => { await supabase.from('notificaciones').delete().eq('id', n.id); load(); }}
                className="p-1 rounded text-slate-300 hover:text-red-400 shrink-0"><Trash2 size={14} /></button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

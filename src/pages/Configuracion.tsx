import { useEffect, useState } from 'react';
import { Image as ImageIcon, PenLine, Save } from 'lucide-react';
import { supabase, type Administracion } from '@/lib/supabase';
import { Button, Card, Input, PageHeader, Spinner } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export function Configuracion() {
  const { usuario, setUsuario } = useApp();
  const [admin, setAdmin] = useState<Administracion | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [operador, setOperador] = useState(usuario);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('administracion').select('*').limit(1).maybeSingle();
    setAdmin(data as Administracion);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!admin) return;
    setSaving(true);
    const { id, ...payload } = admin;
    await supabase.from('administracion').update(payload).eq('id', id);
    setUsuario(operador.trim() || 'Administrador');
    setSaving(false);
    setMsg('Configuración guardada.');
    setTimeout(() => setMsg(''), 2500);
  };

  const subirImagen = (campo: 'logo_url' | 'logo_web_url' | 'firma_url') => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !admin) return;
      const path = `config/${campo}_${Date.now()}.${file.name.split('.').pop()}`;
      const { error } = await supabase.storage.from('archivos').upload(path, file, { upsert: true });
      if (error) { setMsg(`Error al subir: ${error.message}`); return; }
      const { data } = supabase.storage.from('archivos').getPublicUrl(path);
      setAdmin({ ...admin, [campo]: data.publicUrl });
      setMsg('Imagen subida: guardá para confirmar.');
    };
    input.click();
  };

  if (loading) return <Spinner />;
  if (!admin) return <Card className="p-6 text-sm text-slate-500">No se encontró la fila de administración. ¿Corriste la migración SQL en Supabase?</Card>;

  const campoImg = (campo: 'logo_url' | 'logo_web_url' | 'firma_url', titulo: string, desc: string) => (
    <div className="flex items-start gap-4 py-4 border-b border-slate-100 last:border-0">
      <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
        {admin[campo] ? <img src={admin[campo]!} alt={titulo} className="object-contain w-full h-full" /> : campo === 'firma_url' ? <PenLine size={20} className="text-slate-400" /> : <ImageIcon size={20} className="text-slate-400" />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-700">{titulo}</p>
        <p className="text-xs text-slate-400">{admin[campo] ? 'Cargado. Para verlo o cambiarlo, hacé click ' : desc + ' Para cargarlo, hacé click '}
          <button className="text-teal-600 font-medium hover:underline" onClick={() => subirImagen(campo)}>acá</button>
        </p>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Configuración" subtitle="Datos de la administración, operador y branding"
        action={<Button onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Guardando…' : 'Guardar'}</Button>} />
      {msg && <div className="bg-emerald-50 text-emerald-700 text-sm rounded-lg px-4 py-2.5 mb-4">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">Datos de la administración</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><Input label="Nombre" value={admin.nombre} onChange={(v) => setAdmin({ ...admin, nombre: v })} /></div>
            <Input label="CUIT" value={admin.cuit || ''} onChange={(v) => setAdmin({ ...admin, cuit: v })} />
            <Input label="Matrícula RPA" value={admin.rpa || ''} onChange={(v) => setAdmin({ ...admin, rpa: v })} />
            <Input label="Email" value={admin.email || ''} onChange={(v) => setAdmin({ ...admin, email: v })} />
            <Input label="Teléfono" value={admin.telefono || ''} onChange={(v) => setAdmin({ ...admin, telefono: v })} />
            <div className="sm:col-span-2"><Input label="Dirección" value={admin.direccion || ''} onChange={(v) => setAdmin({ ...admin, direccion: v })} /></div>
          </div>
          <div className="mt-5 pt-4 border-t border-slate-100">
            <Input label="Nombre del operador (firma cierres de liquidación y cobranzas)" value={operador} onChange={setOperador} />
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-700 mb-2">Logos y firmas</p>
          {campoImg('logo_url', 'Logo expensa y recibos', 'Tu administración no tiene cargado un logo para expensas y comprobantes.')}
          {campoImg('logo_web_url', 'Logo Web', 'La administración no tiene cargado un logo para la web.')}
          {campoImg('firma_url', 'Firma', 'Firma para los cupones y recibos.')}
        </Card>
      </div>
    </div>
  );
}

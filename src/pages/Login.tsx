import { useState } from 'react';
import { Building2, LogIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Input } from '@/components/ui';
import { useApp } from '@/context/AppContext';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'error' | 'ok'; texto: string } | null>(null);

  const entrar = async () => {
    if (!email.trim() || !password) { setMsg({ tipo: 'error', texto: 'Completá mail y contraseña.' }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) setMsg({ tipo: 'error', texto: error.message.includes('Invalid') ? 'Mail o contraseña incorrectos.' : error.message });
  };

  const recuperar = async () => {
    if (!email.trim()) { setMsg({ tipo: 'error', texto: 'Escribí tu mail y volvé a tocar "Olvidé mi contraseña".' }); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: window.location.origin });
    setBusy(false);
    setMsg(error ? { tipo: 'error', texto: error.message } : { tipo: 'ok', texto: 'Te mandamos un mail para restablecer la contraseña.' });
  };

  return (
    <div className="min-h-screen bg-[#1e2a4a] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <Building2 size={26} className="text-teal-500" />
          <div>
            <p className="font-bold text-slate-800 leading-tight">Consorcios</p>
            <p className="text-[11px] text-slate-400">Panel de administración</p>
          </div>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); entrar(); }} className="space-y-4">
          <Input label="Mail" type="email" value={email} onChange={setEmail} required />
          <Input label="Contraseña" type="password" value={password} onChange={setPassword} required />
          {msg && <p className={`text-sm ${msg.tipo === 'error' ? 'text-red-500' : 'text-emerald-600'}`}>{msg.texto}</p>}
          <Button type="submit" disabled={busy} className="w-full"><LogIn size={15} /> {busy ? 'Ingresando…' : 'Ingresar'}</Button>
        </form>
        <button onClick={recuperar} className="text-xs text-slate-400 hover:text-teal-600 mt-4 w-full text-center" disabled={busy}>Olvidé mi contraseña</button>
      </div>
    </div>
  );
}

/** Pantalla para alguien logueado que no es operador (por ejemplo, un vecino que entró con su cuenta del portal). */
export function SinPermiso({ email }: { email: string }) {
  return (
    <div className="min-h-screen bg-[#1e2a4a] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
        <Building2 size={30} className="text-slate-300 mx-auto mb-3" />
        <p className="font-semibold text-slate-800">Sin acceso</p>
        <p className="text-sm text-slate-500 mt-2">La cuenta <b>{email}</b> no está habilitada como operador de la administración.</p>
        <Button variant="secondary" className="mt-6 w-full" onClick={() => supabase.auth.signOut()}>Salir</Button>
      </div>
    </div>
  );
}

/** Llegó por el link de invitación o de "olvidé mi contraseña": define la contraseña y entra. */
export function NuevaContrasena() {
  const { setElegirContrasena, email } = useApp();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const guardar = async () => {
    if (p1.length < 8) { setMsg('La contraseña tiene que tener al menos 8 caracteres.'); return; }
    if (p1 !== p2) { setMsg('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    window.history.replaceState(null, '', window.location.pathname);
    setElegirContrasena(false);
  };
  return (
    <div className="min-h-screen bg-[#1e2a4a] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-2"><Building2 size={26} className="text-teal-500" /><p className="font-bold text-slate-800">Elegí tu contraseña</p></div>
        <p className="text-sm text-slate-500 mb-5">Para <b>{email}</b>. Con esta contraseña vas a entrar de ahora en más.</p>
        <form onSubmit={(e) => { e.preventDefault(); guardar(); }} className="space-y-4">
          <Input label="Contraseña nueva" type="password" value={p1} onChange={setP1} required />
          <Input label="Repetila" type="password" value={p2} onChange={setP2} required />
          {msg && <p className="text-sm text-red-500">{msg}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Guardando…' : 'Guardar y entrar'}</Button>
        </form>
      </div>
    </div>
  );
}

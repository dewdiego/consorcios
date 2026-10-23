import { useState } from 'react';
import { Building2, LogIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Input } from '@/components/ui';

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

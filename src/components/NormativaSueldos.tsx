import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, ClipboardPaste, ExternalLink, Percent, RefreshCw, Trash2 } from 'lucide-react';
import { supabase, type ConvenioEscala, type NormativaAviso, type NormativaEstado, type NormativaFuente } from '@/lib/supabase';
import { Button, Card, Input, Modal, Select, Table, Td, Textarea } from '@/components/ui';
import { fmtDate, fmtMoney, hoyISO, round2 } from '@/lib/engine';
import { normalizar, parsearEscala } from '@/lib/escala';

/*
  Normativa de sueldos:
  - useNormativa: avisos de cambios (los crea solo la función vigilar-normativa o los publica el superadmin), su estado para esta administración y las fuentes vigiladas.
  - AvisosNormativa: la franja de aviso que ve cada administración, con "Aplicar escala" cuando el aviso trae valores.
  - EscalaRapida: cargar la escala pegando una tabla o aplicando un % a todas las categorías. El superadmin puede publicarla para todas.
  - FuentesNormativa: qué páginas se vigilan y cuándo se revisaron; el superadmin las administra y puede revisar en el momento.
*/

const primerDiaDelMes = () => `${hoyISO().slice(0, 7)}-01`;

export function useNormativa(administracionId: string | null | undefined) {
  const [avisos, setAvisos] = useState<NormativaAviso[]>([]);
  const [estados, setEstados] = useState<NormativaEstado[]>([]);
  const [fuentes, setFuentes] = useState<NormativaFuente[]>([]);
  const [disponible, setDisponible] = useState(true); // false si todavía no se corrió la migración
  const recargar = useCallback(async () => {
    const [a, e, f] = await Promise.all([
      supabase.from('normativa_avisos').select('*').eq('activo', true).order('created_at', { ascending: false }).limit(30),
      administracionId ? supabase.from('normativa_avisos_estado').select('*').eq('administracion_id', administracionId) : Promise.resolve({ data: [], error: null }),
      supabase.from('normativa_fuentes').select('id, nombre, url, patron, tipo, activo, ultimo_titulo, ultimo_link, ultimo_chequeo, ultimo_error').order('created_at'),
    ]);
    setDisponible(!a.error);
    setAvisos((a.data as NormativaAviso[]) || []);
    setEstados((e.data as NormativaEstado[]) || []);
    setFuentes((f.data as NormativaFuente[]) || []);
  }, [administracionId]);
  useEffect(() => { recargar(); }, [recargar]);

  /** Pendientes para esta administración: sin marcar, o marcados "visto" antes de que se publicaran los valores. */
  const pendientes = useMemo(() => avisos.filter((a) => {
    const e = estados.find((x) => x.aviso_id === a.id);
    if (!e) return true;
    return e.estado === 'visto' && !!a.escala && !!a.valores_at && a.valores_at > e.created_at;
  }), [avisos, estados]);

  return { avisos, estados, fuentes, pendientes, disponible, recargar };
}
export type Normativa = ReturnType<typeof useNormativa>;

type Comun = { norm: Normativa; administracionId: string | null | undefined; escalas: ConvenioEscala[]; usuario: string; superadmin: boolean; onCambio: (msg?: string) => void };

/** Guarda filas de escala para una administración (pisa la misma categoría y vigencia si ya existía). */
async function guardarEscalas(administracionId: string, filas: { categoria: string; basico: number }[], vigencia: string, notas: string | null) {
  const { error } = await supabase.from('convenio_escalas').upsert(
    filas.map((f) => ({ administracion_id: administracionId, categoria: f.categoria.trim(), basico: round2(f.basico), vigencia_desde: vigencia, notas })),
    { onConflict: 'administracion_id,categoria,vigencia_desde' },
  );
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ Franja de avisos
export function AvisosNormativa({ norm, administracionId, escalas, usuario, superadmin, onCambio, onIrEscala }: Comun & { onIrEscala: () => void }) {
  const [aplicar, setAplicar] = useState<NormativaAviso | null>(null);
  const [mapa, setMapa] = useState<Record<number, string>>({});
  const [vigencia, setVigencia] = useState(primerDiaDelMes());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const categorias = useMemo(() => [...new Set(escalas.map((x) => x.categoria))], [escalas]);

  const marcar = async (a: NormativaAviso, estado: 'aplicado' | 'visto') => {
    if (!administracionId) return;
    await supabase.from('normativa_avisos_estado').upsert({ aviso_id: a.id, administracion_id: administracionId, estado, usuario, created_at: new Date().toISOString() }, { onConflict: 'aviso_id,administracion_id' });
    await norm.recargar();
  };
  const abrirAplicar = (a: NormativaAviso) => {
    // Cada categoría publicada se empareja sola con la tuya si se llaman igual (sin importar mayúsculas ni acentos)
    setMapa(Object.fromEntries((a.escala || []).map((f, i) => [i, categorias.find((c) => normalizar(c) === normalizar(f.categoria)) || f.categoria])));
    setVigencia(a.vigencia_desde || primerDiaDelMes()); setError(''); setAplicar(a);
  };
  const confirmarAplicar = async () => {
    if (!aplicar?.escala || !administracionId) return;
    setBusy(true); setError('');
    try {
      const filas = aplicar.escala.map((f, i) => ({ categoria: mapa[i] || f.categoria, basico: Number(f.basico) })).filter((f) => f.categoria && f.categoria !== '__omitir');
      if (filas.length === 0) throw new Error('No quedó ninguna categoría para aplicar.');
      await guardarEscalas(administracionId, filas, vigencia, aplicar.titulo);
      await marcar(aplicar, 'aplicado');
      setAplicar(null);
      onCambio(`Escala aplicada: ${filas.length} categorías con vigencia desde el ${fmtDate(vigencia)}. Las liquidaciones de ese mes en adelante ya la usan.`);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const descartarParaTodas = async (a: NormativaAviso) => { await supabase.from('normativa_avisos').update({ activo: false }).eq('id', a.id); await norm.recargar(); };

  if (norm.pendientes.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {norm.pendientes.map((a) => (
        <div key={a.id} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-start gap-3">
          <BellRing size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">Cambio de normativa: {a.titulo}</p>
            <p className="text-xs text-amber-800 mt-0.5">
              {a.detalle} {a.origen === 'automatico' ? 'Detectado automáticamente' : 'Publicado'} el {fmtDate(a.created_at.slice(0, 10))}.
              {a.escala ? ` Ya están cargados los valores de ${a.escala.length} categorías${a.vigencia_desde ? `, vigentes desde el ${fmtDate(a.vigencia_desde)}` : ''}.` : ' Todavía no hay valores cargados para aplicar con un clic.'}
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {a.escala
                ? <Button size="sm" onClick={() => abrirAplicar(a)}>Aplicar escala</Button>
                : <Button size="sm" onClick={onIrEscala}>Cargar la escala</Button>}
              {a.fuente_url && <a href={a.fuente_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-amber-900 underline px-2 py-1.5"><ExternalLink size={13} /> Ver la fuente</a>}
              <Button size="sm" variant="ghost" onClick={() => marcar(a, 'visto')}>Ya lo vi</Button>
              {superadmin && <Button size="sm" variant="ghost" onClick={() => descartarParaTodas(a)}>Descartar para todas</Button>}
            </div>
          </div>
        </div>
      ))}

      <Modal open={!!aplicar} onClose={() => setAplicar(null)} title={`Aplicar: ${aplicar?.titulo || ''}`} size="lg">
        <p className="text-sm text-slate-600 mb-3">Se cargan estos básicos en tu escala. Revisá que cada categoría publicada quede asociada a la tuya; si no la usás, elegí "No aplicar".</p>
        <div className="w-48 mb-3"><Input label="Vigencia desde" type="date" value={vigencia} onChange={setVigencia} /></div>
        <Table headers={['Categoría publicada', 'Básico', 'Categoría en tu sistema']}>
          {(aplicar?.escala || []).map((f, i) => (
            <tr key={i}>
              <Td>{f.categoria}</Td><Td className="font-semibold">{fmtMoney(Number(f.basico))}</Td>
              <Td>
                <select value={mapa[i] ?? f.categoria} onChange={(e) => setMapa({ ...mapa, [i]: e.target.value })} className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  {!categorias.includes(f.categoria) && <option value={f.categoria}>{f.categoria} (nueva)</option>}
                  {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="__omitir">No aplicar</option>
                </select>
              </Td>
            </tr>
          ))}
        </Table>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setAplicar(null)}>Cancelar</Button><Button onClick={confirmarAplicar} disabled={busy}>Aplicar a mi escala</Button></div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ Carga rápida de la escala
export function EscalaRapida({ norm, administracionId, escalas, usuario, superadmin, onCambio }: Comun) {
  const [modo, setModo] = useState<'pegar' | 'pct' | null>(null);
  const [texto, setTexto] = useState('');
  const [columna, setColumna] = useState(0);
  const [filas, setFilas] = useState<{ categoria: string; basico: number }[]>([]);
  const [vigencia, setVigencia] = useState(primerDiaDelMes());
  const [notas, setNotas] = useState('');
  const [pct, setPct] = useState('');
  const [publicar, setPublicar] = useState(false);
  const [avisoId, setAvisoId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parseadas = useMemo(() => parsearEscala(texto), [texto]);
  const maxCols = Math.max(1, ...parseadas.map((f) => f.valores.length));
  useEffect(() => { setFilas(parseadas.map((f) => ({ categoria: f.categoria, basico: f.valores[Math.min(columna, f.valores.length - 1)] }))); }, [parseadas, columna]);

  // Último básico de cada categoría (para el aumento por porcentaje)
  const ultimas = useMemo(() => {
    const m = new Map<string, ConvenioEscala>();
    for (const x of escalas) { const y = m.get(x.categoria); if (!y || x.vigencia_desde > y.vigencia_desde) m.set(x.categoria, x); }
    return [...m.values()].sort((a, b) => a.categoria.localeCompare(b.categoria));
  }, [escalas]);
  const p = parseFloat(pct.replace(',', '.')) || 0;
  const conAumento = ultimas.map((x) => ({ categoria: x.categoria, anterior: Number(x.basico), basico: round2(Number(x.basico) * (1 + p / 100)) }));
  const sinValores = norm.avisos.filter((a) => !a.escala);

  const abrir = (m: 'pegar' | 'pct') => { setModo(m); setError(''); setPublicar(false); setAvisoId(''); setVigencia(primerDiaDelMes()); setNotas(''); };
  const guardar = async () => {
    if (!administracionId) return;
    const lista = (modo === 'pegar' ? filas : conAumento).filter((f) => f.categoria.trim() && f.basico > 0).map((f) => ({ categoria: f.categoria.trim(), basico: f.basico }));
    setBusy(true); setError('');
    try {
      if (lista.length === 0) throw new Error(modo === 'pegar' ? 'No se reconoció ninguna categoría con importe. Cada línea tiene que tener el nombre y el básico.' : 'No hay escala anterior sobre la que aplicar el porcentaje.');
      if (modo === 'pct' && !p) throw new Error('Poné el porcentaje de aumento.');
      const nota = notas.trim() || (modo === 'pct' ? `Aumento ${p}%` : null);
      await guardarEscalas(administracionId, lista, vigencia, nota);
      let extra = '';
      if (superadmin && publicar) {
        const valores = { escala: lista, vigencia_desde: vigencia, valores_at: new Date().toISOString() };
        let publicado = avisoId;
        let e: { message: string } | null = null;
        if (avisoId) ({ error: e } = await supabase.from('normativa_avisos').update(valores).eq('id', avisoId));
        else {
          const r = await supabase.from('normativa_avisos').insert({ tipo: 'escala', titulo: nota || `Nueva escala desde el ${fmtDate(vigencia)}`, detalle: 'Escala publicada por Gestión Íntegra.', origen: 'manual', ...valores }).select('id').single();
          e = r.error; publicado = (r.data as { id: string } | null)?.id || '';
        }
        if (e) throw new Error(`La escala se guardó, pero no se pudo publicar para las demás: ${e.message}`);
        // Quien publica ya la tiene aplicada: no hace falta que le aparezca su propio aviso
        if (publicado) await supabase.from('normativa_avisos_estado').upsert({ aviso_id: publicado, administracion_id: administracionId, estado: 'aplicado', usuario, created_at: new Date().toISOString() }, { onConflict: 'aviso_id,administracion_id' });
        extra = ' Quedó publicada: a cada administración le aparece el aviso con el botón Aplicar.';
        await norm.recargar();
      }
      setModo(null); setTexto(''); setPct('');
      onCambio(`Escala guardada: ${lista.length} categorías con vigencia desde el ${fmtDate(vigencia)}.${extra}`);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const pie = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <Input label="Vigencia desde" type="date" value={vigencia} onChange={setVigencia} />
        <Input label="Notas" value={notas} onChange={setNotas} placeholder="Paritaria noviembre 2026" />
      </div>
      {superadmin && (
        <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={publicar} onChange={(e) => setPublicar(e.target.checked)} className="rounded" /> Publicar para todas las administraciones (les aparece el aviso con el botón Aplicar)</label>
          {publicar && sinValores.length > 0 && <div className="mt-2"><Select label="Asociar a un aviso ya detectado" value={avisoId} onChange={setAvisoId} options={[{ value: '', label: 'Crear un aviso nuevo' }, ...sinValores.map((a) => ({ value: a.id, label: a.titulo }))]} /></div>}
        </div>
      )}
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-5"><Button variant="secondary" onClick={() => setModo(null)}>Cancelar</Button><Button onClick={guardar} disabled={busy}>Guardar escala</Button></div>
    </>
  );

  return (
    <Card className="mb-4 p-5">
      <h3 className="font-semibold text-slate-700 mb-1">Carga rápida</h3>
      <p className="text-xs text-slate-400 mb-3">Cuando sale una paritaria no hace falta tipear categoría por categoría.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => abrir('pegar')}><ClipboardPaste size={15} /> Pegar la tabla de la escala</Button>
        <Button variant="secondary" onClick={() => abrir('pct')} disabled={ultimas.length === 0}><Percent size={15} /> Aplicar un aumento %</Button>
      </div>

      <Modal open={modo === 'pegar'} onClose={() => setModo(null)} title="Pegar la tabla de la escala" size="lg">
        <Textarea label="Copiá la tabla desde la planilla, el PDF o la web y pegala acá (una categoría por línea, con su importe)" value={texto} onChange={setTexto} rows={6} placeholder={'Encargado permanente con vivienda   1.234.567,00\nEncargado permanente sin vivienda   1.300.000,00\nAyudante jornada completa            980.000,00'} />
        {maxCols > 1 && (
          <div className="mt-3 w-72"><Select label="La tabla tiene varias columnas de importes: ¿cuál usar?" value={String(columna)} onChange={(v) => setColumna(parseInt(v))} options={Array.from({ length: maxCols }, (_, i) => ({ value: String(i), label: `Columna ${i + 1}` }))} /></div>
        )}
        {filas.length > 0 && (
          <div className="mt-3 max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
            <Table headers={['Categoría', 'Básico', '']}>
              {filas.map((f, i) => (
                <tr key={i}>
                  <Td><input value={f.categoria} onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, categoria: e.target.value } : x)))} className="w-full text-sm border border-slate-200 rounded px-2 py-1" /></Td>
                  <Td><input type="number" step="0.01" value={f.basico} onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, basico: parseFloat(e.target.value) || 0 } : x)))} className="w-36 text-sm border border-slate-200 rounded px-2 py-1 text-right" /></Td>
                  <Td><button title="Quitar" onClick={() => setFilas(filas.filter((_, j) => j !== i))} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button></Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
        {texto.trim() && filas.length === 0 && <p className="text-sm text-amber-700 mt-3">No se reconoció ninguna línea con categoría e importe.</p>}
        <p className="text-xs text-slate-400 mt-2">Usá los mismos nombres de categoría que tienen cargados tus empleados, así toman el básico nuevo solos. Podés corregirlos en la tabla antes de guardar.</p>
        {pie}
      </Modal>

      <Modal open={modo === 'pct'} onClose={() => setModo(null)} title="Aplicar un aumento a todas las categorías" size="lg">
        <div className="w-48"><Input label="Aumento (%)" type="number" step="0.01" value={pct} onChange={setPct} placeholder="3,5" /></div>
        <div className="mt-3 max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
          <Table headers={['Categoría', 'Básico actual', 'Básico nuevo']}>
            {conAumento.map((f) => <tr key={f.categoria}><Td>{f.categoria}</Td><Td>{fmtMoney(f.anterior)}</Td><Td className="font-semibold">{p ? fmtMoney(f.basico) : '—'}</Td></tr>)}
          </Table>
        </div>
        <p className="text-xs text-slate-400 mt-2">Se calcula sobre el último básico de cada categoría y se guarda como una vigencia nueva; la anterior queda para los meses ya liquidados.</p>
        {pie}
      </Modal>
    </Card>
  );
}

// ------------------------------------------------------------------ Fuentes vigiladas
export function FuentesNormativa({ norm, superadmin }: { norm: Normativa; superadmin: boolean }) {
  const [form, setForm] = useState({ nombre: '', url: '', patron: 'escala' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const revisar = async () => {
    setBusy(true); setMsg('');
    const { data, error } = await supabase.functions.invoke('vigilar-normativa', { body: { forzar: true } });
    if (error) setMsg(`No se pudo revisar: ${error.message}. Verificá que la función vigilar-normativa esté instalada.`);
    else setMsg(((data?.fuentes as { fuente: string; estado: string }[]) || []).map((f) => `${f.fuente}: ${f.estado}`).join(' · ') || 'No hay fuentes activas.');
    await norm.recargar(); setBusy(false);
  };
  const agregar = async () => {
    if (!form.nombre.trim() || !/^https?:\/\//.test(form.url.trim())) { setMsg('Poné un nombre y una dirección que empiece con https://'); return; }
    setBusy(true);
    const { error } = await supabase.from('normativa_fuentes').insert({ nombre: form.nombre.trim(), url: form.url.trim(), patron: form.patron.trim() });
    setMsg(error ? `No se pudo agregar: ${error.message}` : 'Fuente agregada. La primera revisión sólo toma nota de lo publicado; avisa a partir de la siguiente.');
    if (!error) setForm({ nombre: '', url: '', patron: 'escala' });
    await norm.recargar(); setBusy(false);
  };
  const cambiar = async (id: string, cambios: Partial<NormativaFuente>) => { await supabase.from('normativa_fuentes').update(cambios).eq('id', id); await norm.recargar(); };
  const hace = (iso: string | null) => { if (!iso) return 'todavía no se revisó'; const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000); return h < 1 ? 'revisada hace menos de una hora' : h < 48 ? `revisada hace ${h} h` : `revisada hace ${Math.round(h / 24)} días`; };

  if (!norm.disponible) return null;
  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h3 className="font-semibold text-slate-700">Vigilancia de la normativa</h3>
        {superadmin && <Button size="sm" variant="secondary" onClick={revisar} disabled={busy}><RefreshCw size={14} /> Revisar ahora</Button>}
      </div>
      <p className="text-xs text-slate-400 mb-3">El sistema revisa estas páginas oficiales dos veces por día. Cuando aparece una publicación nueva, avisa arriba de esta pantalla y por mail a los administradores.</p>
      {msg && <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-3">{msg}</p>}
      <div className="space-y-2">
        {norm.fuentes.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm border border-slate-200 rounded-lg px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-700">{f.nombre} {!f.activo && <span className="text-xs text-slate-400">(pausada)</span>}</p>
              <p className="text-xs text-slate-500">
                {f.ultimo_titulo ? <>Última publicación: {f.ultimo_link ? <a href={f.ultimo_link} target="_blank" rel="noreferrer" className="underline text-teal-700">{f.ultimo_titulo}</a> : f.ultimo_titulo} · </> : null}{hace(f.ultimo_chequeo)}
              </p>
              {f.ultimo_error && <p className="text-xs text-red-600">No se pudo revisar: {f.ultimo_error}</p>}
            </div>
            <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-teal-700 underline inline-flex items-center gap-1"><ExternalLink size={12} /> abrir</a>
            {superadmin && <>
              <button onClick={() => cambiar(f.id, { activo: !f.activo })} className="text-xs text-slate-500 underline">{f.activo ? 'pausar' : 'reanudar'}</button>
              <button title="Quitar" onClick={async () => { await supabase.from('normativa_fuentes').delete().eq('id', f.id); await norm.recargar(); }} className="p-1.5 rounded text-red-400 hover:bg-red-50"><Trash2 size={14} /></button>
            </>}
          </div>
        ))}
        {norm.fuentes.length === 0 && <p className="text-sm text-slate-400">No hay fuentes cargadas.</p>}
      </div>
      {superadmin && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end mt-4 pt-4 border-t border-slate-100">
          <Input label="Nombre" value={form.nombre} onChange={(v) => setForm({ ...form, nombre: v })} placeholder="FATERYH · novedades" />
          <Input label="Dirección de la página" value={form.url} onChange={(v) => setForm({ ...form, url: v })} placeholder="https://..." />
          <Input label="Palabra a buscar en los títulos" value={form.patron} onChange={(v) => setForm({ ...form, patron: v })} placeholder="escala (vacío = toda la página)" />
          <Button onClick={agregar} disabled={busy}>Agregar fuente</Button>
        </div>
      )}
    </Card>
  );
}

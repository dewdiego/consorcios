import { createClient } from 'npm:@supabase/supabase-js@2';
// Edge Function: interpreta el texto de una liquidación de expensas (formato "Mis Expensas" GCABA, de
// cualquier sistema: Octavo Piso, Roman, Sistemas Administrativos, etc.) y devuelve los datos estructurados.
// Secretos: GEMINI_API_KEY (gratis, Google AI Studio) y/o ANTHROPIC_API_KEY.
// Si están los dos: usa Gemini y, si Gemini falla (saturado, error, respuesta ilegible), pasa a Claude.
// Opcionales: GEMINI_MODEL (default gemini-3.8-flash), ANTHROPIC_MODEL (default claude-sonnet-5-5)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SCHEMA = {
  type: 'object',
  properties: {
    administracion: { type: 'object', properties: { nombre: { type: 'string' }, cuit: { type: 'string' }, email: { type: 'string' }, telefono: { type: 'string' }, rpa: { type: 'string' } } },
    consorcio: {
      type: 'object',
      properties: { nombre: { type: 'string' }, direccion: { type: 'string' }, cuit: { type: 'string' }, clave_suterh: { type: 'string' } },
      required: ['nombre'],
    },
    periodo: { type: 'string', description: 'Período liquidado en formato YYYY-MM' },
    vencimiento_1: { type: ['string', 'null'], description: 'Primer vencimiento YYYY-MM-DD' },
    vencimiento_2: { type: ['string', 'null'], description: 'Segundo vencimiento YYYY-MM-DD, null si no hay' },
    interes_mora_mensual_pct: { type: ['number', 'null'], description: 'Interés mensual por mora si la liquidación lo informa' },
    columnas: {
      type: 'array',
      description: 'Columnas de prorrateo detectadas y a qué categoría del sistema corresponden',
      items: { type: 'object', properties: { titulo_pdf: { type: 'string' }, categoria: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, total: { type: 'number' } }, required: ['titulo_pdf', 'categoria', 'total'] },
    },
    unidades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          uf: { type: 'integer' }, depto: { type: 'string' }, propietario: { type: 'string' },
          coef_a: { type: 'number' }, coef_b: { type: 'number' }, coef_c: { type: 'number' }, coef_d: { type: 'number' },
          monto_a: { type: 'number' }, monto_b: { type: 'number' }, monto_c: { type: 'number' }, monto_d: { type: 'number' },
          saldo_anterior: { type: 'number', description: 'Deuda neta que arrastra la UF después de los pagos del período (negativo si tiene saldo a favor)' },
          intereses: { type: 'number' }, redondeo: { type: 'number' }, total: { type: 'number' },
        },
        required: ['uf', 'depto', 'propietario', 'coef_a', 'coef_b', 'coef_c', 'coef_d', 'monto_a', 'monto_b', 'monto_c', 'monto_d', 'saldo_anterior', 'intereses', 'total'],
      },
    },
    gastos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rubro_pdf: { type: 'string' }, rubro_sistema: { type: 'string', description: 'Uno de los rubros del sistema, el más parecido' },
          proveedor: { type: ['string', 'null'] }, cuit_proveedor: { type: ['string', 'null'] },
          descripcion: { type: 'string' }, comprobante: { type: ['string', 'null'] },
          categoria: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, monto: { type: 'number' },
        },
        required: ['rubro_pdf', 'rubro_sistema', 'descripcion', 'categoria', 'monto'],
      },
    },
    empleados: {
      type: 'array',
      items: {
        type: 'object',
        properties: { nombre: { type: 'string' }, cuil: { type: ['string', 'null'] }, cargo: { type: 'string' }, categoria: { type: ['string', 'null'] }, sueldo_basico: { type: 'number' }, neto: { type: 'number' }, fecha_ingreso: { type: ['string', 'null'] }, vive_en_edificio: { type: 'boolean' } },
        required: ['nombre', 'cargo', 'sueldo_basico', 'neto'],
      },
    },
    totales: { type: 'object', properties: { gastos: { type: 'number' }, distribuido: { type: 'number' } }, required: ['gastos', 'distribuido'] },
    observaciones: { type: 'array', items: { type: 'string' }, description: 'Dudas o cosas que no se pudieron interpretar con certeza' },
  },
  required: ['consorcio', 'periodo', 'columnas', 'unidades', 'gastos', 'totales'],
};

// Gemini usa un subconjunto de OpenAPI: "type" no puede ser lista → se pasa a nullable
function schemaGemini(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(schemaGemini);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'type' && Array.isArray(v)) { out.type = v.find((t) => t !== 'null'); if (v.includes('null')) out.nullable = true; }
      else out[k] = schemaGemini(v);
    }
    return out;
  }
  return node;
}

// Verifica que quien llama sea un operador habilitado (tabla usuarios)
async function esAdmin(req: Request): Promise<{ ok: boolean; email: string }> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return { ok: false, email: '' };
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) return { ok: false, email: '' };
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data } = await sb.from('usuarios').select('id').ilike('email', user.email).eq('activo', true).maybeSingle();
  return { ok: !!data, email: user.email.toLowerCase() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const adm = await esAdmin(req);
  if (!adm.ok) return json({ error: 'Tenés que estar logueado como operador para importar.' }, 403);
  const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!GEMINI_KEY && !ANTHROPIC_KEY) return json({ error: 'Falta el secreto GEMINI_API_KEY (o ANTHROPIC_API_KEY) en Supabase.' }, 500);

  let body: { texto?: string; rubros?: string[] };
  try { body = await req.json(); } catch { return json({ error: 'Body inválido' }, 400); }
  const texto = (body.texto || '').trim();
  if (texto.length < 200) return json({ error: 'El PDF no tiene texto legible (¿es una imagen escaneada?).' }, 400);
  const rubros = body.rubros || [];

  const base = `Sos un asistente experto en administración de consorcios en Argentina. Recibís el texto de una liquidación de
expensas formato "Mis Expensas" (Ley 941 CABA) de cualquier sistema (Octavo Piso, Roman, Sistemas Administrativos u otro).
Devolvé SOLO los datos pedidos, exactos, sin inventar. Números argentinos: "1.234.567,89" = 1234567.89; negativos con "-" o paréntesis.
Categorías de prorrateo destino: A = expensas ordinarias (columna principal), B = cocheras o segunda columna de ordinarias
("Expensas B"), C = fondo / cuota extraordinaria / obras / pintura / reserva, D = gastos particulares. Usá la misma asignación en todo.
periodo "YYYY-MM" (ej. Septiembre 2026 → "2026-09"); fechas "YYYY-MM-DD"; lo que no esté → null o 0.`;

  // ---- Consulta 1: consorcio + planilla de UF (formato compacto para que la respuesta sea corta) ----
  const instrUnidades = `${base}
Tarea: datos del consorcio, período, vencimientos, interés de mora si lo informa, columnas de prorrateo y la planilla
"Estado de cuentas y prorrateo" COMPLETA (todas las UF, sin omitir ninguna). Campos de cada UF, claves cortas:
u = n° de UF (entero), d = depto/piso tal cual, p = propietario, a/b/c/dd = % de las columnas A/B/C/D (0 si no existe),
s = deuda neta que arrastra DESPUÉS de los pagos del período (columna "Deuda" o saldo neto; negativo si pagó de más),
i = intereses punitorios, t = total a pagar de la UF. No incluyas los importes prorrateados (los calculo yo).
cols: una por columna de prorrateo del PDF con su título, categoría y total de la columna.
tg = total general de gastos; td = total de la columna TOTAL de la planilla.`;
  const schemaUnidades = {
    type: 'object',
    properties: {
      adm: { type: 'object', properties: { nombre: { type: 'string' }, cuit: { type: 'string' }, email: { type: 'string' }, telefono: { type: 'string' } } },
      con: { type: 'object', properties: { nombre: { type: 'string' }, direccion: { type: 'string' }, cuit: { type: 'string' } }, required: ['nombre'] },
      periodo: { type: 'string' }, v1: { type: ['string', 'null'] }, v2: { type: ['string', 'null'] }, mora: { type: ['number', 'null'] },
      cols: { type: 'array', items: { type: 'object', properties: { tit: { type: 'string' }, cat: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, tot: { type: 'number' } }, required: ['tit', 'cat', 'tot'] } },
      uf: { type: 'array', items: { type: 'object', properties: {
        u: { type: 'integer' }, d: { type: 'string' }, p: { type: 'string' },
        a: { type: 'number' }, b: { type: 'number' }, c: { type: 'number' }, dd: { type: 'number' },
        s: { type: 'number' }, i: { type: 'number' }, t: { type: 'number' },
      }, required: ['u', 'd', 'p', 'a', 'b', 'c', 'dd', 's', 'i', 't'] } },
      tg: { type: 'number' }, td: { type: 'number' },
      obs: { type: 'array', items: { type: 'string' } },
    },
    required: ['con', 'periodo', 'cols', 'uf', 'tg', 'td'],
  };

  // ---- Consulta 2: gastos + empleados ----
  const instrGastos = `${base}
Tarea: todos los gastos del período y los empleados. Gastos (claves cortas): r = rubro del sistema, EXACTAMENTE uno de:
${rubros.join(' | ')}; p = proveedor (nombre solo, sin CUIT ni domicilio, o null); d = concepto breve (máx. 70 caracteres);
c = categoría A/B/C/D según la columna donde está el importe; m = importe. Un ítem por cada comprobante/concepto, incluidos
sueldos y cargas sociales (rubro de sueldos: un ítem por el neto de cada empleado y uno por cada aporte/contribución).
Empleados: n = nombre, cu = CUIL o null, ca = cargo, cat = categoría o null, b = sueldo básico, ne = neto cobrado.`;
  const schemaGastos = {
    type: 'object',
    properties: {
      g: { type: 'array', items: { type: 'object', properties: {
        r: { type: 'string' }, p: { type: ['string', 'null'] }, d: { type: 'string' }, c: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, m: { type: 'number' },
      }, required: ['r', 'd', 'c', 'm'] } },
      e: { type: 'array', items: { type: 'object', properties: {
        n: { type: 'string' }, cu: { type: ['string', 'null'] }, ca: { type: 'string' }, cat: { type: ['string', 'null'] }, b: { type: 'number' }, ne: { type: 'number' },
      }, required: ['n', 'ca', 'b', 'ne'] } },
      obs: { type: 'array', items: { type: 'string' } },
    },
    required: ['g'],
  };

  const conTimeout = (ms: number) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, listo: () => clearTimeout(t) }; };

  /** Una consulta a la IA: Gemini (un reintento rápido si está saturado) y, si falla, Claude. Tiempos acotados al límite de Supabase. */
  const consultar = async (instrucciones: string, schema: unknown, nombre: string): Promise<Record<string, unknown>> => {
    let errorGemini = '';
    if (GEMINI_KEY) {
      const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
      const cuerpo = JSON.stringify({
        systemInstruction: { parts: [{ text: instrucciones }] },
        contents: [{ role: 'user', parts: [{ text: `Texto de la liquidación:\n\n${texto}` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 12000, responseMimeType: 'application/json', responseSchema: schemaGemini(schema) },
      });
      for (let intento = 1; intento <= 2; intento++) {
        const t = conTimeout(ANTHROPIC_KEY ? 60000 : 125000);
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpo, signal: t.signal,
          });
          const data = await r.json().catch(() => ({})) as { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] };
          if (r.ok) {
            const txt = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
            try { return JSON.parse(txt); } catch { errorGemini = 'respuesta ilegible'; break; }
          }
          errorGemini = data.error?.message || `respondió ${r.status}`;
          if (r.status !== 503 && r.status !== 429) break;
          if (intento === 1) await new Promise((res) => setTimeout(res, 3000));
        } catch (e) {
          errorGemini = (e as Error).name === 'AbortError' ? 'tardó demasiado' : (e as Error).message;
          break;
        } finally { t.listo(); }
      }
      if (!ANTHROPIC_KEY) throw new Error(`Gemini (${nombre}): ${errorGemini}. Probá de nuevo en unos minutos.`);
    }
    const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
    const t = conTimeout(115000);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: t.signal,
        headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, max_tokens: 20000,
          system: `${instrucciones}\n\nRespondé ÚNICAMENTE con un JSON válido (sin texto antes ni después, sin \`\`\`) que cumpla este esquema:\n${JSON.stringify(schema)}`,
          messages: [{ role: 'user', content: `Texto de la liquidación:\n\n${texto}\n\nRespondé sólo con el JSON, empezando directamente con {` }],
        }),
      });
      const data = await r.json() as { error?: { message?: string }; stop_reason?: string; content?: { type: string; text?: string }[] };
      if (!r.ok) throw new Error(`${errorGemini ? `Gemini: ${errorGemini} · ` : ''}Anthropic (${nombre}): ${data.error?.message || `respondió ${r.status}`}`);
      let txt = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
      txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      if (txt.indexOf('{') > 0) txt = txt.slice(txt.indexOf('{'));
      if (data.stop_reason === 'max_tokens') throw new Error(`Anthropic (${nombre}): la respuesta se cortó por tamaño (liquidación muy larga). Probá importando sólo las páginas de unidades/gastos.`);
      try { return JSON.parse(txt.slice(0, txt.lastIndexOf('}') + 1)); }
      catch {
        console.error(`Anthropic (${nombre}) respuesta ilegible:`, txt.slice(0, 500));
        throw new Error(`${errorGemini ? `Gemini: ${errorGemini} · ` : ''}Anthropic (${nombre}): devolvió una respuesta que no se pudo interpretar (empieza: ${txt.slice(0, 80).replace(/\s+/g, ' ')}…).`);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error(`${errorGemini ? `Gemini: ${errorGemini} · ` : ''}Anthropic (${nombre}): tardó demasiado. Probá de nuevo.`);
      throw e;
    } finally { t.listo(); }
  };

  const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

  // Dos consultas en paralelo; después se expande el formato compacto al que usa la app
  const trabajo = async (): Promise<unknown> => {
    const [u, g] = await Promise.all([consultar(instrUnidades, schemaUnidades, 'unidades'), consultar(instrGastos, schemaGastos, 'gastos')]);
    type UF = { u: number; d: string; p: string; a: number; b: number; c: number; dd: number; s: number; i: number; t: number };
    type Col = { tit: string; cat: 'A' | 'B' | 'C' | 'D'; tot: number };
    const cols = ((u.cols as Col[]) || []);
    const totCat: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const c of cols) totCat[c.cat] += Number(c.tot) || 0;
    const unidades = ((u.uf as UF[]) || []).map((x) => ({
      uf: Number(x.u), depto: String(x.d || ''), propietario: String(x.p || ''),
      coef_a: r2(x.a), coef_b: r2(x.b), coef_c: r2(x.c), coef_d: r2(x.dd),
      monto_a: r2(totCat.A * (Number(x.a) || 0) / 100), monto_b: r2(totCat.B * (Number(x.b) || 0) / 100),
      monto_c: r2(totCat.C * (Number(x.c) || 0) / 100), monto_d: r2(totCat.D * (Number(x.dd) || 0) / 100),
      saldo_anterior: r2(x.s), intereses: r2(x.i), total: r2(x.t),
    }));
    type G = { r: string; p: string | null; d: string; c: string; m: number };
    type E = { n: string; cu: string | null; ca: string; cat: string | null; b: number; ne: number };
    const gastos = ((g.g as G[]) || []).map((x) => ({ rubro_pdf: x.r, rubro_sistema: x.r, proveedor: x.p || null, descripcion: x.d, categoria: x.c, monto: r2(x.m) }));
    const empleados = ((g.e as E[]) || []).map((x) => ({ nombre: x.n, cuil: x.cu || null, cargo: x.ca, categoria: x.cat || null, sueldo_basico: r2(x.b), neto: r2(x.ne) }));
    const con = (u.con as { nombre?: string; direccion?: string; cuit?: string }) || {};
    return { resultado: {
      administracion: u.adm || {}, consorcio: { nombre: con.nombre || '', direccion: con.direccion || '', cuit: con.cuit || '' },
      periodo: u.periodo, vencimiento_1: u.v1 || null, vencimiento_2: u.v2 || null, interes_mora_mensual_pct: u.mora ?? null,
      columnas: cols.map((c) => ({ titulo_pdf: c.tit, categoria: c.cat, total: r2(c.tot) })),
      unidades, gastos, empleados,
      totales: { gastos: r2(u.tg), distribuido: r2(u.td) },
      observaciones: [...((u.obs as string[]) || []), ...((g.obs as string[]) || [])],
    } };
  };

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const latido = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch { /* cerrado */ } }, 10000);
      try {
        const res = await trabajo();
        ctrl.enqueue(enc.encode('\n' + JSON.stringify(res)));
      } catch (e) {
        ctrl.enqueue(enc.encode('\n' + JSON.stringify({ error: e instanceof Error ? e.message : String(e) })));
      } finally { clearInterval(latido); ctrl.close(); }
    },
  });
  return new Response(stream, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
});

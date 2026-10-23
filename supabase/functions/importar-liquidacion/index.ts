import { createClient } from 'npm:@supabase/supabase-js@2';
// Edge Function: interpreta el texto de una liquidación de expensas (formato "Mis Expensas" GCABA, de
// cualquier sistema: Octavo Piso, Roman, Sistemas Administrativos, etc.) y devuelve los datos estructurados.
// Secretos: GEMINI_API_KEY (gratis, Google AI Studio) o ANTHROPIC_API_KEY. Si están los dos, se usa Gemini.
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

  const system = `Sos un asistente experto en administración de consorcios en Argentina. Vas a recibir el texto extraído de una
liquidación de expensas con formato "Mis Expensas" (Ley 941 CABA) generada por algún sistema (Octavo Piso, Roman Computación,
Sistemas Administrativos u otro). Tu tarea es volcar TODOS los datos a la estructura pedida, con exactitud numérica.

Reglas:
- Números en formato argentino: "1.234.567,89" = 1234567.89. Los negativos pueden venir con signo "-" o entre paréntesis.
- Categorías de prorrateo del sistema destino: A = expensas ordinarias (la columna principal), B = cocheras o una segunda columna
  de expensas ordinarias ("Expensas B"), C = fondo / cuota extraordinaria / fondo de obras / pintura / reserva, D = gastos particulares
  de cada unidad. Asigná cada columna de prorrateo del PDF a una categoría y usá la misma asignación para los gastos.
- Por cada UF de la planilla "Estado de cuentas y prorrateo": coef_X es el porcentaje de la columna X (0 si no existe), monto_X el
  importe prorrateado de esa columna. saldo_anterior = deuda neta que arrastra DESPUÉS de los pagos recibidos en el período
  (columna "Deuda" o "Saldo anterior" neto; si pagó de más, negativo). intereses = intereses punitorios. total = total a pagar de la UF.
  Incluí TODAS las unidades, sin omitir ninguna.
- Gastos: un ítem por cada comprobante/concepto de las secciones de gastos (sueldos y cargas sociales incluidos, como ítems del
  rubro de sueldos: uno por el neto del empleado y uno por cada aporte/contribución). Respetá en qué columna está el importe para
  asignar la categoría. rubro_sistema debe ser exactamente uno de: ${rubros.join(' | ')}.
  proveedor: el nombre del proveedor si aparece (sin CUIT ni domicilio). descripcion: concepto breve y claro.
- empleados: uno por cada empleado del detalle de sueldos (sueldo_basico = básico, neto = neto cobrado).
- periodo: el mes liquidado (ej. "Septiembre 2026" → "2026-09"). Vencimientos en YYYY-MM-DD.
- totales.gastos = total general de gastos; totales.distribuido = total de la columna TOTAL de la planilla de UF.
- Si algo no está, usá null o 0. Anotá en observaciones cualquier duda relevante.`;

  // El trabajo puede tardar más de 150 s (límite de inactividad de Supabase): se responde en streaming
  // mandando un espacio cada 10 s mientras se espera a la IA, y al final el JSON.
  const trabajo = async (): Promise<unknown> => {
  // ---- Gemini (gratis con API key de Google AI Studio) ----
  if (GEMINI_KEY) {
    const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: `Texto de la liquidación:\n\n${texto}` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 20000, responseMimeType: 'application/json', responseSchema: schemaGemini(SCHEMA) },
      }),
    });
    const data = await r.json();
    if (!r.ok) return { error: data?.error?.message || `Gemini respondió ${r.status}` };
    const txt = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
    try { return { resultado: JSON.parse(txt), modelo: MODEL, tokens: data.usageMetadata }; }
    catch { return { error: 'Gemini devolvió una respuesta que no se pudo interpretar. Probá de nuevo.' }; }
  }

  // ---- Anthropic ----
  const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 16000, system,
      tools: [{ name: 'registrar_liquidacion', description: 'Devuelve la liquidación interpretada', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'registrar_liquidacion' },
      messages: [{ role: 'user', content: `Texto de la liquidación:\n\n${texto}` }],
    }),
  });
  const data = await r.json();
  if (!r.ok) return { error: data?.error?.message || `Anthropic respondió ${r.status}` };
  const tool = (data.content || []).find((c: { type: string }) => c.type === 'tool_use');
  if (!tool) return { error: 'No se pudo interpretar la liquidación.' };
  return { resultado: tool.input, modelo: MODEL, tokens: data.usage };
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

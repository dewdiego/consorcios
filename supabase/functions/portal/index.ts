// Edge Function: backend del Portal del propietario (PWA).
// El portal nunca toca las tablas directamente: todo pasa por acá, y sólo devuelve datos del mail logueado.
// Acciones (POST { accion, ... }):
//   verificar     { email }            → ¿el mail está cargado en alguna unidad? (antes de mandar el código)
//   mis-datos                          → unidades, última expensa y comunicados del usuario (requiere sesión)
//   suscribir     { suscripcion, ua }  → registra el dispositivo para push (requiere sesión)
//   desuscribir   { endpoint }         → da de baja el dispositivo (requiere sesión)
//   vapid                              → clave pública VAPID para el navegador
//   informar-pago { unidad_id, monto, fecha, metodo, referencia, archivo } → avisa un pago (queda a aprobar)
//   reservar / cancelar-reserva / descargo → amenities e infracciones
//   ver-como      { email }            → lo mismo que mis-datos pero para otro mail; sólo para administradores (tabla usuarios)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Unidades donde figura el mail (como propietario o inquilino) */
async function unidadesDe(sb: ReturnType<typeof createClient>, email: string) {
  const e = email.trim().toLowerCase();
  const { data } = await sb.from('unidades')
    .select('id, uf, depto, piso, propietario, propietario_email, inquilino, inquilino_email, alquilada, consorcio_id, consorcios(id, nombre, direccion, administracion_id)')
    .eq('activo', true)
    .or(`propietario_email.ilike.${e},inquilino_email.ilike.${e}`);
  return (data || []) as unknown as {
    id: string; uf: number; depto: string; piso: string | null; propietario: string | null; propietario_email: string | null;
    inquilino: string | null; inquilino_email: string | null; alquilada: boolean; consorcio_id: string;
    consorcios: { id: string; nombre: string; direccion: string | null; administracion_id: string | null } | null;
  }[];
}

/** Todo lo que ve un vecino en el portal: unidades con su última expensa, comunicados, info útil. */
async function datosDe(sb: ReturnType<typeof createClient>, email: string) {
    const us = await unidadesDe(sb, email);
    if (us.length === 0) return { error: 'Tu mail ya no figura en ninguna unidad.' };
    const consorcioIds = [...new Set(us.map((u) => u.consorcio_id))];
    // Administraciones de esos consorcios: lo "general" (sin consorcio) se filtra por ellas, para no mezclar administradoras
    const admIds = [...new Set(us.map((u) => u.consorcios?.administracion_id).filter(Boolean))] as string[];
    const generalDe = (col = 'consorcio_id') => admIds.length ? `${col}.in.(${consorcioIds.join(',')}),and(${col}.is.null,administracion_id.in.(${admIds.join(',')}))` : `${col}.in.(${consorcioIds.join(',')})`;

    // Última liquidación cerrada/enviada de cada consorcio + el cupón de cada unidad
    const { data: liqs } = await sb.from('liquidaciones')
      .select('id, consorcio_id, periodo, estado, fecha_vencimiento_1, fecha_vencimiento_2, pdf_path')
      .in('consorcio_id', consorcioIds).neq('estado', 'abierta').order('periodo', { ascending: false });
    const ultimaPorConsorcio = new Map<string, NonNullable<typeof liqs>[number]>();
    for (const l of liqs || []) if (!ultimaPorConsorcio.has(l.consorcio_id)) ultimaPorConsorcio.set(l.consorcio_id, l);
    const liqIds = [...ultimaPorConsorcio.values()].map((l) => l.id);
    const { data: cupones } = liqIds.length
      ? await sb.from('cupones').select('liquidacion_id, unidad_id, saldo_anterior, intereses, total, total_2do_venc, estado').in('liquidacion_id', liqIds).in('unidad_id', us.map((u) => u.id))
      : { data: [] };
    const { data: pagos } = await sb.from('pagos').select('unidad_id, fecha, monto, metodo').in('unidad_id', us.map((u) => u.id)).order('fecha', { ascending: false }).limit(30);
    // Gastos de la última expensa con sus facturas (si el consorcio lo tiene habilitado) + carpeta externa de comprobantes
    const { data: confs } = await sb.from('consorcios').select('id, url_comprobantes, mostrar_facturas_portal').in('id', consorcioIds);
    const liqConGastos = liqIds.filter((id) => { const l = [...ultimaPorConsorcio.values()].find((x) => x.id === id); const c = (confs || []).find((x) => x.id === l?.consorcio_id); return c?.mostrar_facturas_portal !== false; });
    const { data: gastos } = liqConGastos.length
      ? await sb.from('gastos').select('liquidacion_id, fecha, descripcion, categoria, monto, tipo_comprobante, comprobante, archivo_path, proveedores(nombre), rubros(nombre)').in('liquidacion_id', liqConGastos).order('fecha')
      : { data: [] };
    const gastosDe = (liqId: string) => (gastos || []).filter((g) => g.liquidacion_id === liqId).map((g) => ({
      fecha: g.fecha, descripcion: g.descripcion, categoria: g.categoria, monto: Number(g.monto), comprobante: g.comprobante, tipo_comprobante: g.tipo_comprobante,
      proveedor: (g.proveedores as unknown as { nombre: string } | null)?.nombre || null, rubro: (g.rubros as unknown as { nombre: string } | null)?.nombre || null,
      factura_url: g.archivo_path ? sb.storage.from('archivos').getPublicUrl(g.archivo_path).data.publicUrl : null,
    }));

    const unidades = us.map((u) => {
      const liq = ultimaPorConsorcio.get(u.consorcio_id);
      const cupon = (cupones || []).find((c) => c.unidad_id === u.id && c.liquidacion_id === liq?.id) || null;
      let pdf_url: string | null = null;
      if (liq?.pdf_path) {
        const { data } = sb.storage.from('archivos').getPublicUrl(liq.pdf_path);
        pdf_url = data.publicUrl;
      }
      return {
        id: u.id, uf: u.uf, depto: u.depto, consorcio: u.consorcios?.nombre, direccion: u.consorcios?.direccion,
        rol: (u.propietario_email || '').toLowerCase() === email ? 'propietario' : 'inquilino',
        nombre: (u.propietario_email || '').toLowerCase() === email ? u.propietario : u.inquilino,
        expensa: liq ? {
          periodo: liq.periodo, estado: liq.estado, vencimiento_1: liq.fecha_vencimiento_1, vencimiento_2: liq.fecha_vencimiento_2, pdf_url, cupon,
          gastos: gastosDe(liq.id), url_comprobantes: (confs || []).find((c) => c.id === u.consorcio_id)?.url_comprobantes || null,
        } : null,
        pagos: (pagos || []).filter((p) => p.unidad_id === u.id).slice(0, 6),
      };
    });

    const { data: comunicados } = await sb.from('comunicados')
      .select('id, titulo, contenido, tipo, fecha_publicacion, consorcio_id, adjunto_path, consorcios(nombre)')
      .eq('seccion', 'comunicados').eq('activo', true).neq('estado', 'borrador')
      .or(generalDe())
      .order('fecha_publicacion', { ascending: false }).limit(30);
    const coms = (comunicados || []).map((c) => ({
      ...c, consorcio: (c.consorcios as unknown as { nombre: string } | null)?.nombre || 'Todos', consorcios: undefined,
      adjunto_url: c.adjunto_path ? sb.storage.from('archivos').getPublicUrl(c.adjunto_path).data.publicUrl : null,
    }));

    const { data: subs } = await sb.from('push_suscripciones').select('endpoint').ilike('email', email).eq('activa', true);
    const { data: adm } = admIds.length
      ? await sb.from('administracion').select('nombre, telefono, email, direccion, horario_atencion').eq('id', admIds[0]).maybeSingle()
      : await sb.from('administracion').select('nombre, telefono, email, direccion, horario_atencion').limit(1).maybeSingle();
    // Info útil: administración, datos cargados por el admin y teléfonos (generales + del consorcio)
    const [{ data: info }, { data: tels }] = await Promise.all([
      sb.from('portal_info').select('titulo, contenido, consorcio_id, consorcios(nombre)').eq('activo', true).or(generalDe()).order('orden').order('created_at'),
      sb.from('telefonos').select('nombre, categoria, telefono, notas, consorcio_id, consorcios(nombre)').eq('visible_portal', true).or(generalDe()).order('categoria').order('nombre'),
    ]);
    const conNombre = <T extends { consorcios?: unknown }>(x: T) => ({ ...x, consorcio: (x.consorcios as { nombre: string } | null)?.nombre || null, consorcios: undefined });
    // Trabajos en sus unidades (sólo propietario), con pagos
    const { data: trabs } = await sb.from('trabajos_unidad').select('id, unidad_id, numero, titulo, descripcion, a_cargo, monto, fecha_aviso, fecha_realizado, estado, confirmado_at, observacion_propietario, archivo_path, proveedores(nombre), trabajos_pagos(fecha, monto, metodo)')
      .in('unidad_id', us.filter((u) => (u.propietario_email || '').toLowerCase() === email).map((u) => u.id)).neq('estado', 'cerrado').order('numero', { ascending: false });
    const trabajos = (trabs || []).map((t) => {
      const u = us.find((x) => x.id === t.unidad_id);
      const pagos = (t.trabajos_pagos as { fecha: string; monto: number; metodo: string }[] | null) || [];
      const pagado = pagos.reduce((a, p) => a + Number(p.monto), 0);
      return { ...t, trabajos_pagos: undefined, pagos, pagado, saldo: Math.round((Number(t.monto) - pagado) * 100) / 100, proveedor: (t.proveedores as unknown as { nombre: string } | null)?.nombre || null, proveedores: undefined,
        unidad: u ? `UF ${u.uf} · ${u.depto}` : '', consorcio: u?.consorcios?.nombre || '', archivo_url: t.archivo_path ? sb.storage.from('archivos').getPublicUrl(t.archivo_path).data.publicUrl : null };
    });
    // ---- Pagos informados, reservas, infracciones y reuniones ----
    const uIds = us.map((u) => u.id); const hoy = new Date().toISOString().slice(0, 10);
    const propias = us.filter((u) => (u.propietario_email || '').toLowerCase() === email).map((u) => u.id);
    const [{ data: informados }, { data: amen }, { data: resv }, { data: infr }, { data: reun }] = await Promise.all([
      sb.from('pagos_informados').select('id, unidad_id, fecha, monto, metodo, estado, motivo, created_at').in('unidad_id', uIds).order('created_at', { ascending: false }).limit(20),
      sb.from('amenities').select('id, consorcio_id, nombre, mensaje, max_dia, max_semana, max_mes, dias_anticipacion, dias_cancelacion, costo, horarios').in('consorcio_id', consorcioIds).eq('reservable', true).order('nombre'),
      sb.from('reservas').select('id, amenity_id, unidad_id, fecha, desde, hasta, estado, costo').in('consorcio_id', consorcioIds).eq('estado', 'activa').gte('fecha', hoy).order('fecha'),
      propias.length ? sb.from('infracciones').select('id, unidad_id, tipo, fecha, descripcion, monto, vence_descargo, estado, descargo, resolucion').in('unidad_id', propias).neq('estado', 'cargada').order('fecha', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
      sb.from('reuniones').select('id, consorcio_id, titulo, descripcion, fecha, hora, plataforma, link').in('consorcio_id', consorcioIds).gte('fecha', hoy).not('notificada_at', 'is', null).order('fecha'),
    ]);
    const nombreCons = (id: string) => us.find((u) => u.consorcio_id === id)?.consorcios?.nombre || '';
    const ufDe = (id: string) => { const u = us.find((x) => x.id === id); return u ? `UF ${u.uf} · ${u.depto}` : ''; };
    // De las reservas ajenas sólo se informa que el turno está ocupado (sin datos de quién)
    const ocupacion = (resv || []).map((r) => ({ amenity_id: r.amenity_id, fecha: r.fecha, desde: r.desde }));
    const misReservas = (resv || []).filter((r) => uIds.includes(r.unidad_id)).map((r) => ({ ...r, unidad: ufDe(r.unidad_id) }));
    return { email, unidades, comunicados: coms, dispositivos: (subs || []).length, administracion: adm, info: (info || []).map(conNombre), telefonos: (tels || []).map(conNombre), trabajos,
      informados: (informados || []).map((p) => ({ ...p, unidad: ufDe(p.unidad_id) })),
      amenities: (amen || []).map((a) => ({ ...a, consorcio: nombreCons(a.consorcio_id) })), ocupacion, reservas: misReservas,
      infracciones: (infr || []).map((i) => ({ ...i, unidad: ufDe(i.unidad_id) })),
      reuniones: (reun || []).map((r) => ({ ...r, consorcio: nombreCons(r.consorcio_id) })) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const accion = String(body.accion || '');
  const sb = createClient(URL_SB, SERVICE);

  if (accion === 'vapid') return json({ clave: Deno.env.get('VAPID_PUBLIC_KEY') || null });

  if (accion === 'verificar') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return json({ ok: false, error: 'Ingresá un mail válido.' });
    const us = await unidadesDe(sb, email);
    if (us.length === 0) return json({ ok: false, error: 'Ese mail no figura en ninguna unidad. Pedile a la administración que lo cargue.' });
    return json({ ok: true, consorcios: [...new Set(us.map((u) => u.consorcios?.nombre))] });
  }

  // ---- Acciones con sesión: el usuario viene en el JWT ----
  const auth = req.headers.get('Authorization') || '';
  const userClient = createClient(URL_SB, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) return json({ error: 'Sesión inválida. Volvé a ingresar.' }, 401);
  const email = user.email.toLowerCase();

  if (accion === 'mis-datos') {
    const d = await datosDe(sb, email);
    return 'error' in d ? json(d, 403) : json(d);
  }

  if (accion === 'ver-como') {
    // Sólo administradores (mail en la tabla usuarios, activo)
    const { data: adm } = await sb.from('usuarios').select('id').ilike('email', email).eq('activo', true).maybeSingle();
    if (!adm) return json({ error: 'Sólo para administradores.' }, 403);
    const objetivo = String(body.email || '').trim().toLowerCase();
    if (!objetivo.includes('@')) return json({ error: 'Indicá el mail del vecino.' }, 400);
    const d = await datosDe(sb, objetivo);
    return 'error' in d ? json(d, 404) : json(d);
  }

  if (accion === 'confirmar-trabajo') {
    // El propietario confirma u observa un trabajo de su unidad
    const id = String(body.id || ''); const ok = !!body.ok; const obs = String(body.observacion || '').trim().slice(0, 1000);
    const { data: t } = await sb.from('trabajos_unidad').select('id, titulo, estado, unidad_id, consorcio_id, unidades(uf, depto, propietario_email, consorcios(nombre, administracion_id))').eq('id', id).maybeSingle();
    const un = t?.unidades as unknown as { uf: number; depto: string; propietario_email: string | null; consorcios: { nombre: string; administracion_id: string | null } | null } | null;
    if (!t || (un?.propietario_email || '').toLowerCase() !== email) return json({ error: 'Ese trabajo no corresponde a tu unidad.' }, 403);
    if (!ok && !obs) return json({ error: 'Contanos qué observás del trabajo.' }, 400);
    const { error } = await sb.from('trabajos_unidad').update(ok
      ? { estado: 'confirmado', confirmado_at: new Date().toISOString(), confirmado_por: email, observacion_propietario: obs || null }
      : { estado: 'observado', observacion_propietario: obs }).eq('id', id);
    if (error) return json({ error: error.message }, 500);
    await sb.from('notificaciones').insert({ tipo: ok ? 'info' : 'alerta', titulo: `${ok ? 'Trabajo confirmado' : 'Trabajo observado'} · UF ${un?.uf} ${un?.depto} · ${un?.consorcios?.nombre || ''}`, detalle: `${t.titulo}${obs ? ` — "${obs}"` : ''} (${email})`, administracion_id: un?.consorcios?.administracion_id || null });
    return json({ ok: true });
  }

  if (accion === 'informar-pago') {
    // El vecino avisa que pagó: queda pendiente hasta que la administración lo apruebe
    const us = await unidadesDe(sb, email);
    const u = us.find((x) => x.id === String(body.unidad_id || ''));
    if (!u) return json({ error: 'Esa unidad no figura a tu nombre.' }, 403);
    const monto = Number(String(body.monto ?? '').replace(',', '.'));
    const fecha = String(body.fecha || '');
    if (!(monto > 0)) return json({ error: 'Poné el monto que pagaste.' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ error: 'Indicá la fecha del pago.' }, 400);
    const metodo = ['transferencia', 'efectivo', 'cheque', 'debito', 'tarjeta'].includes(String(body.metodo)) ? String(body.metodo) : 'transferencia';
    let archivo_path: string | null = null;
    const arch = body.archivo as { nombre?: string; tipo?: string; base64?: string } | undefined;
    if (arch?.base64) {
      const bin = Uint8Array.from(atob(arch.base64), (c) => c.charCodeAt(0));
      if (bin.length > 6 * 1024 * 1024) return json({ error: 'El comprobante pesa más de 6 MB. Sacale una foto más chica.' }, 400);
      if (!/^(image\/|application\/pdf)/.test(arch.tipo || '')) return json({ error: 'El comprobante tiene que ser una foto o un PDF.' }, 400);
      archivo_path = `pagos_informados/${u.consorcio_id}/${Date.now()}_${String(arch.nombre || 'comprobante').replace(/[^\w.\-]/g, '_').slice(-60)}`;
      const { error: upErr } = await sb.storage.from('archivos').upload(archivo_path, bin, { contentType: arch.tipo });
      if (upErr) return json({ error: `No se pudo subir el comprobante: ${upErr.message}` }, 500);
    }
    const { data: liq } = await sb.from('liquidaciones').select('id').eq('consorcio_id', u.consorcio_id).neq('estado', 'abierta').order('periodo', { ascending: false }).limit(1).maybeSingle();
    const { data: cup } = liq ? await sb.from('cupones').select('id').eq('liquidacion_id', liq.id).eq('unidad_id', u.id).maybeSingle() : { data: null };
    const { error } = await sb.from('pagos_informados').insert({ consorcio_id: u.consorcio_id, unidad_id: u.id, cupon_id: cup?.id || null, fecha, monto, metodo, referencia: String(body.referencia || '').trim().slice(0, 120) || null, archivo_path, email });
    if (error) return json({ error: error.message }, 500);
    await sb.from('notificaciones').insert({ tipo: 'info', titulo: `Pago informado · UF ${u.uf} ${u.depto} · ${u.consorcios?.nombre || ''}`, detalle: `$ ${monto.toLocaleString('es-AR')} el ${fecha.split('-').reverse().join('/')} (${email}). Revisalo en Expensas → Cobranzas.`, administracion_id: u.consorcios?.administracion_id || null });
    return json({ ok: true });
  }

  if (accion === 'reservar') {
    const us = await unidadesDe(sb, email);
    const u = us.find((x) => x.id === String(body.unidad_id || ''));
    if (!u) return json({ error: 'Esa unidad no figura a tu nombre.' }, 403);
    const { data: a } = await sb.from('amenities').select('*').eq('id', String(body.amenity_id || '')).maybeSingle();
    if (!a || a.consorcio_id !== u.consorcio_id || !a.reservable) return json({ error: 'Ese espacio no se puede reservar.' }, 400);
    const fecha = String(body.fecha || ''); const desde = String(body.desde || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ error: 'Elegí el día.' }, 400);
    const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // día en Argentina
    const dias = Math.round((Date.parse(fecha) - Date.parse(hoy)) / 86400000);
    if (dias < 0) return json({ error: 'Ese día ya pasó.' }, 400);
    if (dias > Number(a.dias_anticipacion)) return json({ error: `Se puede reservar con hasta ${a.dias_anticipacion} días de anticipación.` }, 400);
    const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const turno = ((a.horarios || []) as { dia: number; desde: string; hasta: string; cupo: number }[]).find((h) => h.dia === dia && h.desde === desde);
    if (!turno) return json({ error: 'Ese horario no está habilitado.' }, 400);
    const { data: rs } = await sb.from('reservas').select('unidad_id, fecha, desde').eq('amenity_id', a.id).eq('estado', 'activa').gte('fecha', hoy);
    const todas = (rs || []) as { unidad_id: string; fecha: string; desde: string }[];
    if (todas.filter((r) => r.fecha === fecha && r.desde === desde).length >= Number(turno.cupo || 1)) return json({ error: 'Ese horario ya está reservado.' }, 409);
    const mias = todas.filter((r) => r.unidad_id === u.id);
    const lunes = (f: string) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
    if (mias.filter((r) => r.fecha === fecha).length >= a.max_dia) return json({ error: `Tu unidad ya llegó al máximo de ${a.max_dia} reserva(s) por día.` }, 400);
    if (mias.filter((r) => lunes(r.fecha) === lunes(fecha)).length >= a.max_semana) return json({ error: `Tu unidad ya llegó al máximo de ${a.max_semana} reserva(s) por semana.` }, 400);
    if (mias.filter((r) => r.fecha.slice(0, 7) === fecha.slice(0, 7)).length >= a.max_mes) return json({ error: `Tu unidad ya llegó al máximo de ${a.max_mes} reserva(s) por mes.` }, 400);
    const nombre = (u.propietario_email || '').toLowerCase() === email ? u.propietario : u.inquilino;
    const { data: r, error } = await sb.from('reservas').insert({ amenity_id: a.id, consorcio_id: u.consorcio_id, unidad_id: u.id, fecha, desde, hasta: turno.hasta, email, nombre, costo: a.costo }).select().single();
    if (error) return json({ error: error.message }, 500);
    if (Number(a.costo) > 0) await sb.from('ajustes_unidad').insert({ consorcio_id: u.consorcio_id, unidad_id: u.id, tipo: 'reserva', concepto: `Reserva ${a.nombre} ${fecha.split('-').reverse().join('/')} ${desde}`, monto: a.costo, origen: 'reserva', origen_id: r.id, creado_por: email });
    return json({ ok: true });
  }

  if (accion === 'cancelar-reserva') {
    const us = await unidadesDe(sb, email);
    const { data: r } = await sb.from('reservas').select('id, unidad_id, fecha, amenities(dias_cancelacion)').eq('id', String(body.id || '')).eq('estado', 'activa').maybeSingle();
    if (!r || !us.some((u) => u.id === r.unidad_id)) return json({ error: 'Esa reserva no es de tu unidad.' }, 403);
    const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const dias = Math.round((Date.parse(r.fecha) - Date.parse(hoy)) / 86400000);
    const minimo = Number((r.amenities as unknown as { dias_cancelacion: number } | null)?.dias_cancelacion || 0);
    if (dias < minimo) return json({ error: `Se puede cancelar hasta ${minimo} día(s) antes. Comunicate con la administración.` }, 400);
    await sb.from('reservas').update({ estado: 'cancelada' }).eq('id', r.id);
    await sb.from('ajustes_unidad').delete().eq('origen', 'reserva').eq('origen_id', r.id).is('liquidacion_id', null);
    return json({ ok: true });
  }

  if (accion === 'descargo') {
    // El propietario responde una multa o apercibimiento dentro del plazo
    const texto = String(body.texto || '').trim().slice(0, 2000);
    if (!texto) return json({ error: 'Escribí tu descargo.' }, 400);
    const { data: i } = await sb.from('infracciones').select('id, estado, vence_descargo, descripcion, unidades(uf, depto, propietario_email, consorcios(nombre, administracion_id))').eq('id', String(body.id || '')).maybeSingle();
    const un = i?.unidades as unknown as { uf: number; depto: string; propietario_email: string | null; consorcios: { nombre: string; administracion_id: string | null } | null } | null;
    if (!i || (un?.propietario_email || '').toLowerCase() !== email) return json({ error: 'Esa infracción no corresponde a tu unidad.' }, 403);
    if (i.estado !== 'notificada') return json({ error: 'Esta infracción ya no admite descargo.' }, 400);
    if (i.vence_descargo && i.vence_descargo < new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)) return json({ error: 'El plazo para el descargo ya venció.' }, 400);
    const { error } = await sb.from('infracciones').update({ estado: 'en_revision', descargo: texto, descargo_at: new Date().toISOString(), descargo_por: email }).eq('id', i.id);
    if (error) return json({ error: error.message }, 500);
    await sb.from('notificaciones').insert({ tipo: 'alerta', titulo: `Descargo presentado · UF ${un?.uf} ${un?.depto} · ${un?.consorcios?.nombre || ''}`, detalle: `${i.descripcion} — "${texto.slice(0, 200)}"`, administracion_id: un?.consorcios?.administracion_id || null });
    return json({ ok: true });
  }

  if (accion === 'suscribir') {
    const s = body.suscripcion as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'Suscripción inválida.' }, 400);
    const { error } = await sb.from('push_suscripciones').upsert({
      email, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: String(body.ua || '').slice(0, 200), activa: true, ultimo_error: null,
    }, { onConflict: 'endpoint' });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (accion === 'desuscribir') {
    await sb.from('push_suscripciones').update({ activa: false }).eq('endpoint', String(body.endpoint || '')).ilike('email', email);
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida' }, 400);
});

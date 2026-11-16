import { supabase, type Consorcio, type Unidad } from './supabase';
import { escHtml } from './imprimir';
import { emailsConApp, PORTAL_URL } from './config';

export const METODOS = [{ value: 'transferencia', label: 'Transferencia' }, { value: 'efectivo', label: 'Efectivo' }, { value: 'cheque', label: 'Cheque' }, { value: 'debito', label: 'Débito' }, { value: 'tarjeta', label: 'Tarjeta' }];
export const ufTxt = (u?: Unidad | null) => (u ? `UF ${u.uf} · ${u.depto}` : '—');

/** Cuerpo de mail con el formato del sistema. `cuerpo` ya viene en HTML (escapar lo que escriba el usuario). */
export function mailHtml(titulo: string, subtitulo: string, cuerpo: string, boton?: { texto: string; url: string }) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#334155">
    <h2 style="color:#1b4a9e;margin:0 0 6px">${escHtml(titulo)}</h2>
    <p style="margin:0 0 12px;color:#64748b">${escHtml(subtitulo)}</p>${cuerpo}
    ${boton ? `<p style="margin-top:16px"><a href="${boton.url}" style="display:inline-block;background:#1f6fd0;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escHtml(boton.texto)}</a></p>` : ''}
    <p style="font-size:12px;color:#94a3b8;margin-top:20px">Mensaje automático, no responder.</p></div>`;
}

/**
 * Deja mails (y aviso a la app, si la tienen) en la cola de envíos. Devuelve cuántos destinatarios quedaron encolados.
 * `quienes`: 'propietarios' manda sólo al propietario; 'todos' suma al inquilino.
 */
export async function encolarAviso(consorcio: Consorcio, unidades: Unidad[], asunto: string, html: string, push: string, quienes: 'propietarios' | 'todos' = 'propietarios') {
  const conApp = await emailsConApp(supabase);
  const filas: Record<string, unknown>[] = []; const vistos = new Set<string>();
  for (const u of unidades) {
    const dest: [string | null | undefined, string | null | undefined][] = [[u.propietario_email, u.propietario]];
    if (quienes === 'todos') dest.push([u.inquilino_email, u.inquilino]);
    for (const [mail, nombre] of dest) {
      const email = (mail || '').trim().toLowerCase();
      if (!email.includes('@') || vistos.has(email)) continue;
      vistos.add(email);
      filas.push({ consorcio_id: consorcio.id, unidad_id: u.id, email, nombre: nombre || null, canal: 'mail', asunto, html });
      if (conApp.has(email)) filas.push({ consorcio_id: consorcio.id, unidad_id: u.id, email, nombre: nombre || null, canal: 'push', asunto, html: null, push_titulo: consorcio.nombre, push_cuerpo: push, push_url: PORTAL_URL });
    }
  }
  if (filas.length) { const { error } = await supabase.from('cola_envios').insert(filas); if (error) throw new Error(error.message); }
  return vistos.size;
}

type Opciones = {
  /** Si se pasa, aparece el botón "Guardar PDF": genera el PDF en el navegador (sin diálogo de impresión) y lo entrega acá. Devuelve el texto de confirmación. */
  onGuardar?: (pdf: Blob) => Promise<string>;
  /** Generador vectorial del PDF (jsPDF). Si está, se usa en lugar de la captura de pantalla. */
  generarPdf?: () => Promise<Blob>;
  nombreArchivo?: string;
};

/** Abre una ventana con el HTML listo para imprimir / guardar como PDF (Ctrl+P → Guardar como PDF). */
export function imprimirHtml(titulo: string, cuerpo: string, extraCss = '', opciones: Opciones = {}) {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { alert('El navegador bloqueó la ventana de impresión. Permití ventanas emergentes para este sitio.'); return; }
  (w as unknown as { __onGuardar?: Opciones['onGuardar']; __generarPdf?: Opciones['generarPdf'] }).__onGuardar = opciones.onGuardar;
  (w as unknown as { __generarPdf?: Opciones['generarPdf'] }).__generarPdf = opciones.generarPdf;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 12px; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
  h3 { font-size: 12px; margin: 12px 0 4px; color: #475569; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #94a3b8; padding: 4px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: bold; border-top: 2px solid #475569; border-bottom: 0; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e2a4a; padding-bottom: 10px; margin-bottom: 14px; }
  .cab .adm { font-size: 11px; color: #475569; line-height: 1.4; }
  .cab .doc { text-align: right; } .cab .doc b { font-size: 16px; display: block; }
  .mut { color: #64748b; } .chico { font-size: 10px; }
  .caja { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; margin: 10px 0; }
  .firma { margin-top: 60px; display: flex; justify-content: space-between; }
  .firma div { width: 45%; border-top: 1px solid #334155; padding-top: 6px; text-align: center; font-size: 11px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
  .btns { position: fixed; top: 10px; right: 10px; display: flex; gap: 8px; z-index: 50; }
  .btn { background: #14b8a6; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  .btn.sec2 { background: #1e2a4a; } .btn:disabled { opacity: .6; }
  .aviso { position: fixed; top: 50px; right: 10px; background: #1e293b; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 12px; display: none; z-index: 50; }
  @media print { .btns, .aviso { display: none !important; } body { padding: 0; } }
  ${extraCss}
</style></head><body>
<div class="btns">
  ${opciones.onGuardar ? '<button class="btn sec2" id="btn-guardar" onclick="__guardar()">Guardar PDF</button>' : ''}
  ${opciones.onGuardar ? `<button class="btn sec2" onclick="__guardar(true)">Bajar PDF</button>` : ''}
  <button class="btn" onclick="window.print()">Imprimir</button>
</div>
<div class="aviso" id="aviso"></div>
${cuerpo}
<script>
// Generación del PDF en el navegador (html2canvas + jsPDF): cada bloque .sec se dibuja como imagen y se pagina en A4;
// los bloques .apaisado van en hoja apaisada. Sin diálogo de impresión ni encabezados del navegador.
function __cargar(src) { return new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => err(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); }); }
function __aviso(t) { const a = document.getElementById('aviso'); a.textContent = t; a.style.display = t ? 'block' : 'none'; }
async function __guardar(bajar) {
  const b = document.getElementById('btn-guardar'); if (b) b.disabled = true;
  try {
    __aviso('Generando PDF…');
    if (window.__generarPdf) {
      const blob = await window.__generarPdf();
      if (bajar) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = ${JSON.stringify(opciones.nombreArchivo || titulo)} + '.pdf'; a.click(); __aviso('PDF descargado.'); }
      else { const msg = await window.__onGuardar(blob); __aviso(msg || 'Guardado.'); }
      if (b) b.disabled = false; setTimeout(() => __aviso(''), 6000); return;
    }
    if (!window.html2canvas) await __cargar('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    if (!window.jspdf) await __cargar('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const M = 10, W = 210 - 2 * M, H = 297 - 2 * M;
    let y = M, primera = true;
    const bloques = Array.from(document.querySelectorAll('body > .sec, body > p, body > .caja'));
    // Se dibuja al ancho real de la hoja (190 mm útiles; 277 mm en apaisado) para que el texto quede del tamaño correcto
    const anchoPrev = document.body.style.width; const padPrev = document.body.style.padding;
    document.body.style.width = '190mm'; document.body.style.padding = '0';
    for (const el of bloques) {
      const apaisado = el.classList.contains('apaisado');
      if (apaisado) el.style.width = '277mm';
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: apaisado ? 1100 : 760 });
      if (apaisado) el.style.width = '';
      const img = canvas.toDataURL('image/jpeg', 0.92);
      if (apaisado) {
        pdf.addPage('a4', 'landscape');
        const LW = 297 - 2 * M, LH = 210 - 2 * M;
        let w = LW, h = canvas.height * w / canvas.width;
        if (h > LH) { h = LH; w = canvas.width * h / canvas.height; }
        pdf.addImage(img, 'JPEG', M, M, w, h);
        pdf.addPage('a4', 'portrait'); y = M; primera = false;
        continue;
      }
      const h = canvas.height * W / canvas.width;
      if (h > H) {
        // Bloque más alto que una hoja: se corta en tiras
        let offset = 0; const pxPorMm = canvas.width / W;
        while (offset < canvas.height) {
          const tira = Math.min(canvas.height - offset, Math.floor((H - (y - M)) * pxPorMm));
          if (tira <= 0) { pdf.addPage(); y = M; continue; }
          const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = tira;
          c2.getContext('2d').drawImage(canvas, 0, offset, canvas.width, tira, 0, 0, canvas.width, tira);
          pdf.addImage(c2.toDataURL('image/jpeg', 0.92), 'JPEG', M, y, W, tira / pxPorMm);
          offset += tira; y += tira / pxPorMm + 3;
          if (offset < canvas.height) { pdf.addPage(); y = M; }
        }
        continue;
      }
      if (!primera && y + h > 297 - M) { pdf.addPage(); y = M; }
      pdf.addImage(img, 'JPEG', M, y, W, h); y += h + 3; primera = false;
    }
    document.body.style.width = anchoPrev; document.body.style.padding = padPrev;
    // Quita una última página vacía si quedó
    const pages = pdf.getNumberOfPages(); if (pages > 1 && y === M) pdf.deletePage(pages);
    const blob = pdf.output('blob');
    if (bajar === 'ver') { window.open(URL.createObjectURL(blob), '_blank'); __aviso('PDF abierto en otra pestaña: desde ahí se imprime (Ctrl+P).'); }
    else if (bajar) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = ${JSON.stringify(opciones.nombreArchivo || titulo)} + '.pdf'; a.click(); __aviso('PDF descargado.'); }
    else { const msg = await window.__onGuardar(blob); __aviso(msg || 'Guardado.'); }
  } catch (e) { __aviso('Error: ' + (e && e.message ? e.message : e)); }
  if (b) b.disabled = false;
  setTimeout(() => __aviso(''), 6000);
}
</script>
</body></html>`);
  w.document.close();
  w.focus();
}

export const escHtml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

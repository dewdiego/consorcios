/** Abre una ventana con el HTML listo para imprimir / guardar como PDF (Ctrl+P → Guardar como PDF). */
export function imprimirHtml(titulo: string, cuerpo: string, extraCss = '') {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { alert('El navegador bloqueó la ventana de impresión. Permití ventanas emergentes para este sitio.'); return; }
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
  .btn { position: fixed; top: 10px; right: 10px; background: #14b8a6; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } body { padding: 0; } }
  ${extraCss}
</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / Guardar PDF</button>
${cuerpo}
</body></html>`);
  w.document.close();
  w.focus();
}

export const escHtml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

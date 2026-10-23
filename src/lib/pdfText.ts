// Extrae el texto de un PDF en el navegador respetando filas y columnas (para la planilla de prorrateo).
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

type Item = { str: string; x: number; y: number; w: number };

export async function extraerTextoPdf(file: File, onProgreso?: (pagina: number, total: number) => void): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const paginas: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    onProgreso?.(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items as { str: string; transform: number[]; width: number }[]) {
      if (!it.str || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
    }
    // Algunos PDF (Ghostscript) dibujan el texto en negrita 3 o 4 veces superpuesto: se deja una sola copia
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const unicos: Item[] = [];
    for (const it of items) {
      const dup = unicos.some((u) => u.str === it.str && Math.abs(u.x - it.x) < 1.5 && Math.abs(u.y - it.y) < 1.5);
      if (!dup) unicos.push(it);
    }
    items.length = 0; items.push(...unicos);
    // Agrupar por renglón (misma y ± 2.5pt), ordenar por x, y separar columnas por el espacio entre ítems
    const lineas: Item[][] = [];
    for (const it of items) {
      const ultima = lineas[lineas.length - 1];
      if (ultima && Math.abs(ultima[0].y - it.y) <= 2.5) ultima.push(it);
      else lineas.push([it]);
    }
    const texto = lineas.map((l) => {
      l.sort((a, b) => a.x - b.x);
      let s = '';
      let finAnterior = -1;
      for (const it of l) {
        if (finAnterior >= 0) {
          const gap = it.x - finAnterior;
          s += gap > 12 ? '   ' : gap > 1.5 ? ' ' : '';
        }
        s += it.str;
        finAnterior = it.x + it.w;
      }
      return s;
    }).join('\n');
    paginas.push(`=== PÁGINA ${p} ===\n${texto}`);
  }
  return paginas.join('\n\n');
}

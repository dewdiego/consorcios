/*
  Carga rápida de la escala del convenio:
  - parsearEscala: convierte un texto pegado (de una planilla, un PDF o una web) en filas { categoria, valores[] }.
    Cada línea es una categoría; los importes que encuentre a la derecha son las columnas (por ejemplo 1ª, 2ª, 3ª y 4ª categoría de edificio).
  - normalizar: para comparar nombres de categoría sin importar mayúsculas, acentos ni signos.
*/
export type FilaEscala = { categoria: string; valores: number[] };

/** "1.234.567,89", "1234567.89", "$ 1.234.567" → número. Devuelve NaN si no es un importe. */
export function aNumero(t: string): number {
  let s = t.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');           // coma decimal, puntos de miles
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');          // sólo puntos de miles
  return parseFloat(s);
}

// Un importe: con separador de miles (1.234.567 o 1.234.567,89) o un número largo (de 4 cifras o más), con decimales opcionales
const IMPORTE = /\$?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{4,}(?:[.,]\d{1,2})?)/g;

const MINIMO = 20000;

export function parsearEscala(texto: string): FilaEscala[] {
  const filas: FilaEscala[] = [];
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.replace(/\t/g, '  ').trim();
    if (!linea) continue;
    const hallados = [...linea.matchAll(IMPORTE)];
    // Se descartan los números que no son sueldos: años, números de ley o de convenio (un básico nunca baja de MINIMO)
    const validos = hallados.filter((m) => { const n = aNumero(m[1]); return Number.isFinite(n) && n >= MINIMO; });
    if (validos.length === 0) continue;                                       // títulos y encabezados
    const valores = validos.map((m) => aNumero(m[1]));
    const corte = validos[0].index!;
    const categoria = linea.slice(0, corte).replace(/[$:|·\-–\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
    if (!categoria) continue;
    filas.push({ categoria, valores });
  }
  return filas;
}

export const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();

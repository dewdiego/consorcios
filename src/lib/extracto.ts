/*
  Extracto bancario: lectura de CSV / texto pegado desde Excel y cruce automático contra los movimientos del sistema.
  No depende del banco: busca la columna de fecha, la descripción y el importe (una columna con signo, o débito y crédito).
*/
export type LineaExtracto = { fecha: string; descripcion: string; monto: number };
export type MovSistema = { id: string; fecha: string; tipo: 'ingreso' | 'egreso'; monto: number };

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
export const aImporte = (s: string): number | null => {
  let t = String(s).trim(); if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /-/.test(t);
  t = t.replace(/[^\d.,]/g, ''); if (!/\d/.test(t)) return null;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{1,2}$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(/[.,]/g, '');
  const n = parseFloat(t); return Number.isFinite(n) ? (neg ? -n : n) : null;
};
const aFecha = (s: string): string | null => {
  const m = String(s).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/) ; if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const iso = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/); return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
};
function partir(linea: string, sep: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') { if (q && linea[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === sep && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map((x) => x.trim());
}

export function parsearExtracto(texto: string): { lineas: LineaExtracto[]; descartadas: number } {
  const filas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!filas.length) return { lineas: [], descartadas: 0 };
  const sep = ['\t', ';', ','].map((s) => [s, filas.slice(0, 10).reduce((a, l) => a + partir(l, s).length, 0)] as const).sort((a, b) => b[1] - a[1])[0][0];
  const tabla = filas.map((l) => partir(l, sep));
  // Encabezado: la primera fila que nombra fecha e importe/débito/crédito
  const iEnc = tabla.findIndex((f) => f.some((c) => /^fecha/.test(norm(c))) && f.some((c) => /(importe|monto|debito|credito|debe|haber)/.test(norm(c))));
  let cFecha = -1, cDesc = -1, cImp = -1, cDeb = -1, cCre = -1;
  if (iEnc >= 0) tabla[iEnc].forEach((c, i) => {
    const n = norm(c);
    if (cFecha < 0 && /^fecha/.test(n)) cFecha = i;
    else if (cDesc < 0 && /(descripcion|concepto|detalle|referencia|movimiento)/.test(n)) cDesc = i;
    else if (cDeb < 0 && /(debito|debe)/.test(n)) cDeb = i;
    else if (cCre < 0 && /(credito|haber)/.test(n)) cCre = i;
    else if (cImp < 0 && /(importe|monto)/.test(n)) cImp = i;
  });
  const lineas: LineaExtracto[] = []; let descartadas = 0;
  for (const f of tabla.slice(iEnc + 1)) {
    let fecha: string | null = null, descripcion = '', monto: number | null = null;
    if (iEnc >= 0) {
      fecha = aFecha(f[cFecha] || ''); descripcion = cDesc >= 0 ? f[cDesc] || '' : '';
      if (cImp >= 0) monto = aImporte(f[cImp] || '');
      else { const d = Math.abs(aImporte(f[cDeb] || '') || 0), c = Math.abs(aImporte(f[cCre] || '') || 0); monto = c ? c : d ? -d : null; }
    } else {
      // Sin encabezado: primera celda con fecha, primer importe después, texto más largo como descripción
      const iF = f.findIndex((c) => aFecha(c)); if (iF >= 0) fecha = aFecha(f[iF]);
      const resto = f.filter((_, i) => i !== iF);
      const nums = resto.map((c) => (/^[\s$()+-]*[\d.,]+\)?$/.test(c) && /[.,]\d{2}\)?$/.test(c) ? aImporte(c) : null));
      const iN = nums.findIndex((n) => n !== null && n !== 0); monto = iN >= 0 ? nums[iN] : null;
      descripcion = resto.filter((c, i) => nums[i] === null && !aFecha(c)).sort((a, b) => b.length - a.length)[0] || '';
    }
    if (fecha && monto) lineas.push({ fecha, descripcion: descripcion.replace(/\s+/g, ' ').trim().slice(0, 200), monto: Math.round(monto * 100) / 100 });
    else descartadas++;
  }
  return { lineas, descartadas };
}

/** Texto del banco sin números ni fechas: sirve para reconocer el mismo concepto en otros extractos. */
export const patronDe = (descripcion: string) => norm(descripcion).replace(/[\d/.-]+/g, ' ').replace(/\s+/g, ' ').trim();

const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
/** Empareja cada línea del banco con el movimiento del sistema de igual importe y signo más cercano en fecha (hasta `tolerancia` días). */
export function identificar<L extends LineaExtracto & { id: string }>(lineas: L[], movs: MovSistema[], tolerancia = 5): Map<string, string> {
  const usados = new Set<string>(); const pares = new Map<string, string>();
  const candidatos: { l: string; m: string; d: number }[] = [];
  for (const l of lineas) for (const m of movs) {
    const firmado = m.tipo === 'ingreso' ? Number(m.monto) : -Number(m.monto);
    if (Math.abs(firmado - l.monto) < 0.005 && dias(l.fecha, m.fecha) <= tolerancia) candidatos.push({ l: l.id, m: m.id, d: dias(l.fecha, m.fecha) });
  }
  for (const c of candidatos.sort((a, b) => a.d - b.d)) { if (pares.has(c.l) || usados.has(c.m)) continue; pares.set(c.l, c.m); usados.add(c.m); }
  return pares;
}

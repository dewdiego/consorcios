/*
  Lectura de facturas en PDF (con texto): saca CUIT del emisor, tipo, número, fecha, total y CAE.
  Pensado para el formato estándar de ARCA/AFIP (facturas A, B y C) y tolerante con otros (servicios públicos):
  lo que no encuentra queda vacío para completarlo a mano.
*/
export type FacturaLeida = { cuit: string | null; tipo: string | null; comprobante: string | null; fecha: string | null; total: number | null; cae: string | null; razonSocial: string | null };

const aNumero = (s: string): number => {
  let t = s.replace(/[^\d.,]/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');      // 1.234,56
  else if (/\.\d{1,2}$/.test(t)) t = t.replace(/,/g, '');                    // 1,234.56
  else t = t.replace(/[.,]/g, '');
  return parseFloat(t) || 0;
};
const MONTO = '\\$?\\s*(\\d{1,3}(?:[.,]\\d{3})*[.,]\\d{2}|\\d+[.,]\\d{2})';
const soloDigitos = (s: string) => s.replace(/\D/g, '');

export function leerFactura(texto: string): FacturaLeida {
  const t = texto.replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  // CUIT del emisor: el primero que aparece (en el formato oficial el del cliente viene después)
  const cuits = [...t.matchAll(/C\.?U\.?I\.?T\.?\s*(?:N[°ºro.]*)?\s*:?\s*(\d{2}-?\d{8}-?\d)/gi)].map((m) => soloDigitos(m[1]));
  const cuit = cuits[0] || null;
  // Tipo: por código de comprobante o por la letra
  const cod = t.match(/COD\.?\s*0*(\d{1,3})\b/i)?.[1];
  const porCodigo: Record<string, string> = { '1': 'Factura A', '6': 'Factura B', '11': 'Factura C', '51': 'Factura M', '2': 'Nota de débito', '7': 'Nota de débito', '12': 'Nota de débito', '3': 'Nota de crédito', '8': 'Nota de crédito', '13': 'Nota de crédito', '4': 'Recibo', '9': 'Recibo', '15': 'Recibo' };
  let tipo = cod ? porCodigo[cod] || null : null;
  if (!tipo) {
    const m = t.match(/\b(FACTURA|NOTA DE CR[EÉ]DITO|NOTA DE D[EÉ]BITO|RECIBO)\b\s*(?:TIPO\s*)?["“]?([ABCM])\b/i) || t.match(/\b([ABCM])\s+(FACTURA)\b/i);
    if (m) { const [x, y] = /^[ABCM]$/i.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]]; const base = x.toUpperCase(); tipo = base === 'FACTURA' ? `Factura ${y.toUpperCase()}` : base.includes('CR') ? 'Nota de crédito' : base.includes('D') && base.startsWith('NOTA') ? 'Nota de débito' : 'Recibo'; }
  }
  // Número: "Punto de Venta: 00002 Comp. Nro: 00001234" o directamente 0002-00001234
  const pv = t.match(/Punto de Venta:?\s*(\d{1,5})/i)?.[1]; const nro = t.match(/Comp\.?\s*Nro\.?:?\s*(\d{1,8})/i)?.[1];
  const directo = t.match(/\b(\d{4,5})\s?-\s?(\d{8})\b/);
  const comprobante = pv && nro ? `${String(parseInt(pv, 10)).padStart(4, '0')}-${nro.padStart(8, '0')}` : directo ? `${directo[1]}-${directo[2]}` : null;
  // Fecha de emisión
  const f = t.match(/Fecha de Emisi[oó]n:?\s*(\d{2})[/-](\d{2})[/-](\d{4})/i) || t.match(/\bFecha:?\s*(\d{2})[/-](\d{2})[/-](\d{4})/i) || t.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
  const fecha = f ? `${f[3]}-${f[2]}-${f[1]}` : null;
  // Total: la etiqueta más específica primero; si no hay, el importe más grande que acompañe a la palabra TOTAL
  let total: number | null = null;
  for (const etiqueta of ['Importe Total', 'TOTAL A PAGAR', 'Total a pagar', 'IMPORTE TOTAL', 'Total:', 'TOTAL']) {
    const ms = [...t.matchAll(new RegExp(`${etiqueta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*${MONTO}`, 'gi'))].map((m) => aNumero(m[1])).filter((n) => n > 0);
    if (ms.length) { total = Math.max(...ms); break; }
  }
  const cae = t.match(/CAE\s*(?:N[°ºro.]*)?\s*:?\s*(\d{14})/i)?.[1] || null;
  const razonSocial = t.match(/Raz[oó]n Social:?\s*([^\n]{3,60}?)(?=\s+C\.?U\.?I\.?T|\s+Fecha|\s+Domicilio|\s+Ingresos|\n|$)/i)?.[1]?.trim() || null;
  return { cuit, tipo, comprobante, fecha, total, cae, razonSocial };
}

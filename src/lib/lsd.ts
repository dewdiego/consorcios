/*
  Libro de Sueldos Digital (ARCA): archivo TXT de "Liquidación de SyJ / DJ F931".
  Diseño de registros según el documento oficial LSDiseInterfazLiquidacion.pdf (registros 01 a 04; el 05 es sólo para
  empresas de servicios eventuales). Con este archivo ARCA arma el libro y la declaración jurada F931.
  Los códigos de situación, condición, actividad, modalidad, localidad y obra social salen de las tablas de
  Declaración en Línea: los define el contador y se cargan una vez por empleado.
*/
export type DatosF931 = {
  legajo?: string; conyuge?: boolean; hijos?: number; cct?: boolean; scvo?: boolean; reduccion?: boolean;
  tipo_empleador?: string; situacion?: string; condicion?: string; actividad?: string; modalidad?: string;
  siniestrado?: string; localidad?: string; obra_social?: string; adherentes?: number;
};
export const F931_DEFECTO: Required<Pick<DatosF931, 'cct' | 'scvo' | 'reduccion' | 'tipo_empleador' | 'situacion' | 'condicion' | 'siniestrado'>> =
  { cct: true, scvo: true, reduccion: false, tipo_empleador: '1', situacion: '01', condicion: '01', siniestrado: '00' };
/** Códigos que no tienen un valor seguro por defecto: los tiene que dar el contador. */
export const F931_OBLIGATORIOS: { k: keyof DatosF931; label: string; largo: number }[] = [
  { k: 'actividad', label: 'Actividad', largo: 3 }, { k: 'modalidad', label: 'Modalidad de contratación', largo: 3 },
  { k: 'localidad', label: 'Localidad (zona)', largo: 2 }, { k: 'obra_social', label: 'Obra social (código)', largo: 6 },
];

export type LineaLsd = { concepto: string; tipo: 'rem' | 'norem' | 'desc'; monto: number };
export type EmpleadoLsd = { nombre: string; cuil: string | null; cbu: string | null; datos: DatosF931; lineas: LineaLsd[]; bruto: number; noRemunerativo: number; fechaPago: string | null; orden: number };

const ascii = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\x20-\x7E]/g, ' ');
const alfa = (s: string | null | undefined, n: number) => ascii(String(s ?? '')).slice(0, n).padEnd(n, ' ');
const num = (v: number | string | null | undefined, n: number) => String(Math.max(0, Math.round(Number(v) || 0))).slice(-n).padStart(n, '0');
const imp = (v: number) => num(Math.round(Math.abs(Number(v) || 0) * 100), 15);       // 13 enteros + 2 decimales, sin separador
const pct = (v: number) => num(Math.round((Number(v) || 0) * 100), 5);
const soloDig = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');
const marca = (b: boolean | undefined) => (b ? '1' : '0');

/** Código de concepto (hasta 10 caracteres) estable a partir del nombre: es el que hay que dar de alta en ARCA. */
export function codigoConcepto(concepto: string): string {
  const t = ascii(concepto).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim();
  const palabras = t.split(/\s+/).filter((p) => !['DE', 'DEL', 'LA', 'EL', 'Y', 'AL', 'POR'].includes(p));
  const cod = palabras.length === 1 ? palabras[0] : palabras.map((p, i) => (/^\d+$/.test(p) ? p : p.slice(0, i === 0 ? 4 : 3))).join('');
  return (cod || 'CONCEPTO').slice(0, 10);
}

export function validarLsd(cuitEmpleador: string | null | undefined, emps: EmpleadoLsd[]): string[] {
  const e: string[] = [];
  if (soloDig(cuitEmpleador).length !== 11) e.push('El consorcio no tiene el CUIT cargado (11 dígitos).');
  if (!emps.length) e.push('No hay liquidaciones confirmadas en el período.');
  for (const x of emps) {
    if (soloDig(x.cuil).length !== 11) e.push(`${x.nombre}: falta el CUIL (11 dígitos).`);
    const faltan = F931_OBLIGATORIOS.filter((o) => !String(x.datos[o.k] ?? '').trim()).map((o) => o.label);
    if (faltan.length) e.push(`${x.nombre}: falta ${faltan.join(', ')}.`);
    if (!x.fechaPago) e.push(`${x.nombre}: falta la fecha de pago (registrá el pago del sueldo).`);
  }
  return e;
}

/** Arma el TXT. `periodo` AAAA-MM; `nroLiquidacion` es el número de liquidación del empleador en ARCA para ese período. */
export function generarLsd(cuitEmpleador: string, periodo: string, nroLiquidacion: number, emps: EmpleadoLsd[]): string {
  const L: string[] = [];
  L.push('01' + num(soloDig(cuitEmpleador), 11) + 'SJ' + periodo.replace('-', '') + 'M' + num(nroLiquidacion, 5) + '30' + num(emps.length, 6));
  for (const x of emps) {
    const cbu = soloDig(x.cbu); const acredita = cbu.length === 22;
    L.push('02' + num(soloDig(x.cuil), 11) + alfa(x.datos.legajo || String(x.orden), 10) + alfa('', 50) + alfa(acredita ? cbu : '', 22) + num(30, 3)
      + num((x.fechaPago || '').replace(/-/g, ''), 8) + alfa('', 8) + (acredita ? '3' : '1'));
  }
  for (const x of emps) for (const l of x.lineas) {
    if (!(Number(l.monto) > 0)) continue;
    L.push('03' + num(soloDig(x.cuil), 11) + alfa(codigoConcepto(l.concepto), 10) + num(0, 5) + ' ' + imp(l.monto) + (l.tipo === 'desc' ? 'D' : 'C') + alfa('', 6));
  }
  for (const x of emps) {
    const d = { ...F931_DEFECTO, ...x.datos }; const rem = Number(x.bruto) || 0; const total = rem + (Number(x.noRemunerativo) || 0);
    L.push('04' + num(soloDig(x.cuil), 11) + marca(d.conyuge) + num(d.hijos, 2) + marca(d.cct) + marca(d.scvo) + marca(d.reduccion)
      + alfa(d.tipo_empleador, 1) + '0' + alfa(d.situacion, 2) + alfa(d.condicion, 2) + alfa(d.actividad, 3) + alfa(d.modalidad, 3) + alfa(d.siniestrado, 2) + alfa(d.localidad, 2)
      + alfa(d.situacion, 2) + num(1, 2) + alfa('', 2) + num(0, 2) + alfa('', 2) + num(0, 2)     // situación de revista 1 (desde el día 1), 2 y 3 sin uso
      + num(30, 2) + num(0, 3) + pct(0) + pct(0) + alfa(d.obra_social, 6) + num(d.adherentes, 2)
      + imp(0) + imp(0)                       // aporte y contribución adicional de obra social
      + imp(0) + imp(0) + imp(0)              // bases diferenciales (sin uso)
      + imp(0)                                // remuneración por maternidad
      + imp(total)                            // remuneración bruta
      + imp(rem) + imp(rem) + imp(rem) + imp(rem) + imp(rem)   // bases imponibles 1 a 5
      + imp(0) + imp(0)                       // bases 6 y 7 (regímenes diferenciales)
      + imp(rem) + imp(total)                 // base 8 (contribución obra social) y base 9 (LRT)
      + imp(0) + imp(0)                       // bases diferenciales de seguridad social (sin uso)
      + imp(rem) + imp(0));                   // base 10 e importe a detraer
  }
  return L.join('\r\n') + '\r\n';
}

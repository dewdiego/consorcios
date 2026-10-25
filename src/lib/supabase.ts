import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const url = SUPABASE_URL, key = SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

// ==================== Tipos ====================

export type Administracion = {
  id: string; nombre: string; cuit: string | null; email: string | null; telefono: string | null;
  direccion: string | null; rpa: string | null; logo_url: string | null; logo_web_url: string | null;
  firma_url: string | null;
};

export type Usuario = {
  id: string; nombre: string; email: string; rol: 'admin' | 'operador' | 'consulta'; activo: boolean; created_at: string;
};

export type Notificacion = {
  id: string; tipo: string; titulo: string; detalle: string | null; leida: boolean; created_at: string;
};

export type Consorcio = {
  id: string; nombre: string; direccion: string | null; ciudad: string | null; cuit: string | null;
  telefono: string | null; email: string | null; cantidad_pisos: number; activo: boolean;
  banco: string | null; cbu: string | null; fecha_asamblea: string | null; fecha_mandato_hasta: string | null;
  dia_vencimiento_1: number; dia_vencimiento_2: number;
  recargo_2do_venc_pct: number; interes_mora_mensual_pct: number;
  honorarios_mensuales: number; notas: string | null; created_at: string;
};

export type Unidad = {
  id: string; consorcio_id: string; uf: number; depto: string; piso: string | null;
  superficie_m2: number;
  propietario: string | null; propietario_telefono: string | null; propietario_email: string | null; propietario_dni: string | null;
  alquilada: boolean; inquilino: string | null; inquilino_telefono: string | null; inquilino_email: string | null;
  coef_a: number; coef_b: number; coef_c: number; coef_d: number;
  activo: boolean; created_at: string;
};

export type Proveedor = {
  id: string; nombre: string; cuit: string | null; telefono: string | null; email: string | null;
  contacto: string | null; direccion: string | null; categoria: string; cbu: string | null;
  activo: boolean; created_at: string;
  condicion_iva: 'ri' | 'monotributo' | 'exento';
  ret_ganancias: boolean; ret_ganancias_alic: number | null;
  ret_iibb: boolean; ret_iibb_alic: number | null;
  ret_suss: boolean; ret_suss_alic: number | null;
};

export type Parametro = { clave: string; grupo: string; descripcion: string; valor: number; orden: number };
export type ConvenioEscala = { id: string; categoria: string; basico: number; vigencia_desde: string; notas: string | null };
export type ConsorcioPoliza = {
  id: string; consorcio_id: string; tipo: string; compania: string | null; numero: string | null;
  vencimiento: string; monto: number | null; archivo_path: string | null; notas: string | null;
};

export type Certificacion = {
  id: string; proveedor_id: string; requerimiento: string; periodo: string; vencimiento: string | null;
  validado: boolean; validado_por: string | null; archivo_url: string | null; created_at: string;
  proveedores?: Proveedor;
};

export type Rubro = { id: string; nombre: string; orden: number };

export type Liquidacion = {
  id: string; consorcio_id: string; periodo: string; estado: 'abierta' | 'cerrada' | 'enviada';
  fecha_vencimiento_1: string | null; fecha_vencimiento_2: string | null;
  recargo_2do_venc_pct: number; interes_mora_pct: number;
  total_gastos: number; total_distribuido: number;
  cerrada_por: string | null; cerrada_at: string | null; enviada_at: string | null;
  pdf_path: string | null;
  notas: string | null; created_at: string;
  consorcios?: Consorcio;
};

export type Categoria = 'A' | 'B' | 'C' | 'D';

export type Gasto = {
  id: string; consorcio_id: string; liquidacion_id: string | null; proveedor_id: string | null;
  rubro_id: string | null; descripcion: string; categoria: Categoria; monto: number; fecha: string;
  comprobante: string | null; cae: string | null; pagado: boolean; fecha_pago: string | null;
  orden_pago_id: string | null; created_at: string;
  monto_a: number; monto_b: number; monto_c: number; monto_d: number;
  periodo_facturado: string | null; tipo_comprobante: string; recurrente: boolean; extraordinario: boolean; notas: string | null;
  proveedores?: Proveedor; rubros?: Rubro; consorcios?: Consorcio;
};

export type Provision = {
  id: string; consorcio_id: string; descripcion: string; proveedor_id: string | null; rubro_id: string | null;
  categoria: Categoria; monto_mensual: number; activa: boolean;
  proveedores?: Proveedor; rubros?: Rubro;
};

export type Cupon = {
  id: string; liquidacion_id: string; consorcio_id: string; unidad_id: string;
  monto_a: number; monto_b: number; monto_c: number; monto_d: number;
  saldo_anterior: number; intereses: number; total: number; total_2do_venc: number;
  estado: 'pendiente' | 'parcial' | 'pagado'; created_at: string;
  unidades?: Unidad; liquidaciones?: Liquidacion;
};

export type Pago = {
  id: string; consorcio_id: string; unidad_id: string; cupon_id: string | null;
  fecha: string; monto: number; metodo: string; comprobante: string | null; observaciones: string | null;
  registrado_por: string | null; created_at: string;
  unidades?: Unidad; cupones?: Cupon;
};

export type OrdenPago = {
  id: string; consorcio_id: string; proveedor_id: string | null; numero: number; fecha: string;
  monto: number; metodo: string; cheque_id: string | null;
  estado: 'pendiente' | 'pagada' | 'anulada'; observaciones: string | null; created_at: string;
  retenciones_total: number; neto_pagado: number | null; fecha_pago: string | null;
  proveedores?: Proveedor;
};

export type Cheque = {
  id: string; consorcio_id: string; banco: string; numero: string; monto: number;
  fecha_emision: string; fecha_cobro: string | null; origen: 'propio' | 'recibido';
  estado: string; destino: string | null; created_at: string;
};

export type PlanPago = {
  id: string; consorcio_id: string; unidad_id: string; deuda_original: number; interes_pct: number;
  cantidad_cuotas: number; monto_cuota: number; cuotas_pagadas: number; fecha_inicio: string;
  estado: 'vigente' | 'cumplido' | 'caido'; observaciones: string | null;
  unidades?: Unidad;
};

export type FacturaAdmin = {
  id: string; tipo: 'emitida' | 'recibida'; consorcio_id: string | null; periodo: string | null;
  concepto: string; numero: string | null; cae: string | null; monto: number;
  estado: 'pendiente' | 'pagada' | 'anulada'; fecha: string; created_at: string;
  consorcios?: Consorcio;
};

export type Reclamo = {
  id: string; consorcio_id: string; unidad_id: string | null; numero: number; titulo: string;
  descripcion: string | null; categoria: string; prioridad: string; estado: string;
  proveedor_id: string | null; etiquetas: string | null; fecha_resolucion: string | null; created_at: string;
  unidades?: Unidad; proveedores?: Proveedor;
};

export type ReclamoEvento = {
  id: string; reclamo_id: string; tipo: string; detalle: string; autor: string | null; created_at: string;
};

export type Consulta = {
  id: string; consorcio_id: string; unidad_id: string | null; numero: number; destinatario: string;
  asunto: string; mensaje: string | null; estado: 'abierta' | 'respondida' | 'cerrada';
  respuesta: string | null; respondida_at: string | null; created_at: string;
  unidades?: Unidad;
};

export type Comunicado = {
  id: string; consorcio_id: string | null; seccion: 'novedades' | 'comunicados' | 'muro'; tipo: string;
  titulo: string; contenido: string; fijado: boolean; activo: boolean; fecha_publicacion: string; created_at: string;
  numero: number | null; estado: 'borrador' | 'programado' | 'enviado'; etiquetas: string | null;
  destinatarios: 'todos' | 'propietarios' | 'inquilinos'; programado_at: string | null; ultimo_envio: string | null; adjunto_path: string | null;
  canal: 'mail' | 'push' | 'ambos';
  consorcios?: Consorcio;
};

export type MantenimientoTipo = { id: string; nombre: string; periodicidad_dias: number };

export type Mantenimiento = {
  id: string; consorcio_id: string; tipo_id: string | null; proveedor_id: string | null;
  descripcion: string | null; ultimo_mnt: string | null; vencimiento: string;
  recurrente: boolean; periodicidad_dias: number; created_at: string;
  mantenimiento_tipos?: MantenimientoTipo; proveedores?: Proveedor; consorcios?: Consorcio;
};

export type PedidoCompra = {
  id: string; consorcio_id: string; numero: number; descripcion: string; detalle: string | null;
  estado: string; created_at: string; consorcios?: Consorcio;
};

export type Cotizacion = {
  id: string; pedido_id: string; proveedor_id: string | null; monto: number; plazo_dias: number | null;
  notas: string | null; elegida: boolean; created_at: string;
  proveedores?: Proveedor; pedidos_compra?: PedidoCompra;
};

export type OrdenCompra = {
  id: string; pedido_id: string; cotizacion_id: string | null; numero: number; fecha: string;
  estado: string; created_at: string;
  pedidos_compra?: PedidoCompra; cotizaciones?: Cotizacion;
};

export type Empleado = {
  id: string; consorcio_id: string; nombre: string; cuil: string | null; cargo: string;
  categoria: string | null; sueldo_basico: number; antiguedad_fecha: string | null;
  vive_en_edificio: boolean; activo: boolean; created_at: string;
  usar_escala: boolean; adic_titulo: boolean; adic_vidrios: boolean; adic_residuos: boolean; adic_jardin: boolean;
  obra_social: string | null; cbu: string | null; fecha_egreso: string | null; jornada: string;
};

export type ReciboLinea = { concepto: string; tipo: 'rem' | 'norem' | 'desc'; monto: number; detalle?: string };

export type SueldoLiquidacion = {
  id: string; consorcio_id: string; empleado_id: string; periodo: string;
  basico: number; antiguedad: number; adicionales: number; no_remunerativo: number;
  bruto: number; aportes: number; neto: number; contribuciones: number; costo_total: number;
  estado: 'preliquidada' | 'liquidada' | 'pagada'; gasto_id: string | null; created_at: string;
  horas_50: number; horas_100: number; horas_extras: number; adic_convenio: number; sac: number;
  vacaciones: number; dias_vacaciones: number; descuentos: number; detalle: ReciboLinea[] | null;
  observaciones: string | null; fecha_pago: string | null; recibo_nro: number;
  empleados?: Empleado;
};

export type Cuenta = {
  id: string; consorcio_id: string; nombre: string; tipo: 'caja' | 'banco'; banco: string | null;
  cbu: string | null; saldo_inicial: number; fecha_saldo_inicial: string; predeterminada: boolean; activa: boolean;
};

export type Conciliacion = {
  id: string; consorcio_id: string; cuenta_id: string; periodo: string;
  saldo_extracto: number | null; cerrada: boolean; notas: string | null;
};

export type Movimiento = {
  id: string; consorcio_id: string; cuenta_id: string | null; fecha: string; tipo: 'ingreso' | 'egreso';
  concepto: string; monto: number; origen: string; origen_id: string | null; conciliado: boolean; created_at: string;
  comprobante: string | null; fecha_conciliado: string | null;
  cuentas?: Cuenta;
};

export type Retencion = {
  id: string; consorcio_id: string; proveedor_id: string | null; tipo: string; monto: number;
  fecha: string; certificado: string | null; base: number | null; alicuota: number | null;
  estado: 'pendiente' | 'depositada'; orden_pago_id: string | null; movimiento_id: string | null; depositada_at: string | null;
  proveedores?: Proveedor;
};

export type Evento = {
  id: string; consorcio_id: string | null; titulo: string; tipo: string; fecha: string;
  hora: string | null; notas: string | null; consorcios?: Consorcio;
};

export type Archivo = {
  id: string; consorcio_id: string | null; nombre: string; categoria: string;
  storage_path: string | null; url_externa: string | null; subido_por: string | null; created_at: string;
  consorcios?: Consorcio;
};

export type Telefono = {
  id: string; consorcio_id: string | null; nombre: string; categoria: string; telefono: string; notas: string | null;
};

export type Encuesta = {
  id: string; consorcio_id: string; titulo: string; descripcion: string | null;
  estado: 'abierta' | 'cerrada'; fecha_cierre: string | null; created_at: string;
};

export type EncuestaOpcion = { id: string; encuesta_id: string; texto: string; votos: number };

/*
  # Esquema v2 — Sistema de Administración de Consorcios
  Reemplaza por completo el esquema anterior (Bolt). Ejecutar en el SQL Editor de Supabase.

  Circuito central:
    gastos (categoría A/B/C/D) → liquidación mensual → prorrateo por coeficiente de cada UF
    → cupones (1º y 2º vencimiento con recargo) → pagos / cobranza → cuenta corriente por UF.

  Categorías de prorrateo (igual que la pantalla de Unidades):
    A = Expensas ordinarias · B = Cocheras · C = Cuota extraordinaria · D = Gastos particulares
*/

-- ==== LIMPIEZA DEL ESQUEMA ANTERIOR ====
DROP TABLE IF EXISTS pagos, expensas, reclamos, reservas, comunicados, proveedores,
  unidades, consorcios, operational_items, facturas_recibidas CASCADE;

-- ==================== ADMINISTRACIÓN (datos propios) ====================
CREATE TABLE administracion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL DEFAULT 'Mi Administración',
  cuit text, email text, telefono text, direccion text,
  rpa text,                          -- matrícula Registro Público de Administradores
  logo_url text, logo_web_url text, firma_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  email text NOT NULL UNIQUE,
  rol text NOT NULL DEFAULT 'operador' CHECK (rol IN ('admin','operador','consulta')),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE notificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL DEFAULT 'info',           -- info | alerta | vencimiento
  titulo text NOT NULL,
  detalle text,
  leida boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ==================== CONSORCIOS ====================
CREATE TABLE consorcios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  direccion text, ciudad text, cuit text, telefono text, email text,
  cantidad_pisos integer DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  -- Reglas de liquidación (configurables por consorcio)
  dia_vencimiento_1 integer NOT NULL DEFAULT 10 CHECK (dia_vencimiento_1 BETWEEN 1 AND 28),
  dia_vencimiento_2 integer NOT NULL DEFAULT 20 CHECK (dia_vencimiento_2 BETWEEN 1 AND 28),
  recargo_2do_venc_pct numeric(6,2) NOT NULL DEFAULT 2.00,   -- % recargo pagando después del 1º venc.
  interes_mora_mensual_pct numeric(6,2) NOT NULL DEFAULT 0,  -- % mensual sobre saldo vencido arrastrado
  honorarios_mensuales numeric(14,2) NOT NULL DEFAULT 0,     -- honorarios de la administración
  notas text,
  created_at timestamptz DEFAULT now()
);

-- ==================== UNIDADES ====================
CREATE TABLE unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  uf integer NOT NULL,                 -- número de UF (orden)
  depto text NOT NULL,                 -- ej: "1-2", "PB A"
  piso text,
  superficie_m2 numeric(10,2) DEFAULT 0,
  propietario text, propietario_telefono text, propietario_email text, propietario_dni text,
  alquilada boolean NOT NULL DEFAULT false,
  inquilino text, inquilino_telefono text, inquilino_email text,
  -- Coeficientes de prorrateo (%) por categoría; la suma por categoría debe dar 100 en el consorcio
  coef_a numeric(8,4) NOT NULL DEFAULT 0,   -- A: expensas ordinarias
  coef_b numeric(8,4) NOT NULL DEFAULT 0,   -- B: cocheras
  coef_c numeric(8,4) NOT NULL DEFAULT 0,   -- C: cuota extraordinaria
  coef_d numeric(8,4) NOT NULL DEFAULT 0,   -- D: gastos particulares
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (consorcio_id, uf)
);
CREATE INDEX idx_unidades_consorcio ON unidades(consorcio_id);

-- ==================== PROVEEDORES (globales de la administración) ====================
CREATE TABLE proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  cuit text, telefono text, email text, contacto text, direccion text,
  categoria text NOT NULL DEFAULT 'otros',
  cbu text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Certificación de proveedores (documentación con vencimiento: ART, seguros, F.931, matrículas)
CREATE TABLE proveedor_certificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id uuid NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  requerimiento text NOT NULL,          -- ej: "Seguro ART", "F.931", "Matrícula"
  periodo text NOT NULL,                -- YYYY-MM
  vencimiento date,
  validado boolean NOT NULL DEFAULT false,
  validado_por text,
  archivo_url text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_certs_proveedor ON proveedor_certificaciones(proveedor_id);

-- ==================== RUBROS DE GASTO ====================
CREATE TABLE rubros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  orden integer NOT NULL DEFAULT 99
);
INSERT INTO rubros (nombre, orden) VALUES
  ('Sueldos y cargas sociales', 1), ('Limpieza', 2), ('Seguridad / Vigilancia', 3),
  ('Ascensores', 4), ('Reparaciones y mantenimiento', 5), ('Servicios públicos', 6),
  ('Administración / Honorarios', 7), ('Seguros', 8), ('Bancarios e impuestos', 9),
  ('Abonos y servicios', 10), ('Otros', 99)
ON CONFLICT DO NOTHING;

-- ==================== LIQUIDACIONES (expensas del período) ====================
CREATE TABLE liquidaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  periodo text NOT NULL,                -- YYYY-MM
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada','enviada')),
  fecha_vencimiento_1 date,
  fecha_vencimiento_2 date,
  recargo_2do_venc_pct numeric(6,2) NOT NULL DEFAULT 0,    -- snapshot de la config al liquidar
  interes_mora_pct numeric(6,2) NOT NULL DEFAULT 0,        -- snapshot
  total_gastos numeric(14,2) NOT NULL DEFAULT 0,           -- se recalcula al generar cupones
  total_distribuido numeric(14,2) NOT NULL DEFAULT 0,      -- Σ cupones (incluye saldos e intereses)
  cerrada_por text, cerrada_at timestamptz,
  enviada_at timestamptz,
  notas text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (consorcio_id, periodo)
);
CREATE INDEX idx_liq_consorcio ON liquidaciones(consorcio_id);
CREATE INDEX idx_liq_periodo ON liquidaciones(periodo);

-- ==================== GASTOS ====================
CREATE TABLE gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  liquidacion_id uuid REFERENCES liquidaciones(id) ON DELETE SET NULL,  -- NULL = gasto pendiente (no vinculado)
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  rubro_id uuid REFERENCES rubros(id) ON DELETE SET NULL,
  descripcion text NOT NULL,
  categoria text NOT NULL DEFAULT 'A' CHECK (categoria IN ('A','B','C','D')),
  monto numeric(14,2) NOT NULL CHECK (monto >= 0),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  comprobante text, cae text,
  pagado boolean NOT NULL DEFAULT false,
  fecha_pago date,
  orden_pago_id uuid,                   -- FK diferida a ordenes_pago
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_gastos_consorcio ON gastos(consorcio_id);
CREATE INDEX idx_gastos_liquidacion ON gastos(liquidacion_id);

-- Provisiones: gastos fijos mensuales que se vuelcan al período con un click
CREATE TABLE provisiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  descripcion text NOT NULL,
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  rubro_id uuid REFERENCES rubros(id) ON DELETE SET NULL,
  categoria text NOT NULL DEFAULT 'A' CHECK (categoria IN ('A','B','C','D')),
  monto_mensual numeric(14,2) NOT NULL DEFAULT 0,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ==================== CUPONES (expensa de cada UF en cada liquidación) ====================
CREATE TABLE cupones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id uuid NOT NULL REFERENCES liquidaciones(id) ON DELETE CASCADE,
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  monto_a numeric(14,2) NOT NULL DEFAULT 0,
  monto_b numeric(14,2) NOT NULL DEFAULT 0,
  monto_c numeric(14,2) NOT NULL DEFAULT 0,
  monto_d numeric(14,2) NOT NULL DEFAULT 0,
  saldo_anterior numeric(14,2) NOT NULL DEFAULT 0,   -- deuda (+) o saldo a favor (−) al momento de liquidar
  intereses numeric(14,2) NOT NULL DEFAULT 0,        -- mora sobre saldo vencido
  total numeric(14,2) NOT NULL DEFAULT 0,            -- a pagar al 1º vencimiento
  total_2do_venc numeric(14,2) NOT NULL DEFAULT 0,   -- a pagar al 2º vencimiento (con recargo)
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','parcial','pagado')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (liquidacion_id, unidad_id)
);
CREATE INDEX idx_cupones_liq ON cupones(liquidacion_id);
CREATE INDEX idx_cupones_unidad ON cupones(unidad_id);

-- ==================== PAGOS (cobranza) ====================
CREATE TABLE pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  cupon_id uuid REFERENCES cupones(id) ON DELETE SET NULL,   -- NULL = pago a cuenta
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  monto numeric(14,2) NOT NULL CHECK (monto > 0),
  metodo text NOT NULL DEFAULT 'transferencia' CHECK (metodo IN ('efectivo','transferencia','cheque','debito','tarjeta')),
  comprobante text, observaciones text,
  registrado_por text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_pagos_consorcio ON pagos(consorcio_id);
CREATE INDEX idx_pagos_unidad ON pagos(unidad_id);
CREATE INDEX idx_pagos_cupon ON pagos(cupon_id);

-- ==================== ÓRDENES DE PAGO A PROVEEDORES ====================
CREATE TABLE ordenes_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  numero serial,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  monto numeric(14,2) NOT NULL DEFAULT 0,
  metodo text NOT NULL DEFAULT 'transferencia' CHECK (metodo IN ('efectivo','transferencia','cheque')),
  cheque_id uuid,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','anulada')),
  observaciones text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE gastos ADD CONSTRAINT fk_gastos_op FOREIGN KEY (orden_pago_id) REFERENCES ordenes_pago(id) ON DELETE SET NULL;

-- ==================== CHEQUES ====================
CREATE TABLE cheques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  banco text NOT NULL,
  numero text NOT NULL,
  monto numeric(14,2) NOT NULL,
  fecha_emision date NOT NULL DEFAULT CURRENT_DATE,
  fecha_cobro date,
  origen text NOT NULL DEFAULT 'propio' CHECK (origen IN ('propio','recibido')),
  estado text NOT NULL DEFAULT 'en_cartera' CHECK (estado IN ('en_cartera','entregado','debitado','depositado','rechazado','anulado')),
  destino text,
  created_at timestamptz DEFAULT now()
);

-- ==================== PLANES DE PAGO (refinanciación de deuda) ====================
CREATE TABLE planes_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  deuda_original numeric(14,2) NOT NULL,
  interes_pct numeric(6,2) NOT NULL DEFAULT 0,
  cantidad_cuotas integer NOT NULL CHECK (cantidad_cuotas > 0),
  monto_cuota numeric(14,2) NOT NULL,
  cuotas_pagadas integer NOT NULL DEFAULT 0,
  fecha_inicio date NOT NULL DEFAULT CURRENT_DATE,
  estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','cumplido','caido')),
  observaciones text,
  created_at timestamptz DEFAULT now()
);

-- ==================== HONORARIOS / FACTURACIÓN PROPIA ====================
CREATE TABLE facturas_admin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL DEFAULT 'emitida' CHECK (tipo IN ('emitida','recibida')),
  consorcio_id uuid REFERENCES consorcios(id) ON DELETE SET NULL,
  periodo text,                          -- YYYY-MM
  concepto text NOT NULL,
  numero text, cae text,
  monto numeric(14,2) NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagada','anulada')),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- ==================== RECLAMOS ====================
CREATE TABLE reclamos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid REFERENCES unidades(id) ON DELETE SET NULL,
  numero serial,
  titulo text NOT NULL,
  descripcion text,
  categoria text NOT NULL DEFAULT 'otro' CHECK (categoria IN ('plomeria','electricidad','estructura','limpieza','seguridad','ascensores','humedad','otro')),
  prioridad text NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja','media','alta','urgente')),
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','en_proceso','presupuestado','resuelto','cerrado')),
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  etiquetas text,
  fecha_resolucion date,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_reclamos_consorcio ON reclamos(consorcio_id);

CREATE TABLE reclamo_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reclamo_id uuid NOT NULL REFERENCES reclamos(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'comentario' CHECK (tipo IN ('comentario','cambio_estado','presupuesto','visita')),
  detalle text NOT NULL,
  autor text,
  created_at timestamptz DEFAULT now()
);

-- ==================== CONSULTAS (mesa de entradas de vecinos) ====================
CREATE TABLE consultas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid REFERENCES unidades(id) ON DELETE SET NULL,
  numero serial,
  destinatario text NOT NULL DEFAULT 'administracion' CHECK (destinatario IN ('administracion','encargado','consejo')),
  asunto text NOT NULL,
  mensaje text,
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','respondida','cerrada')),
  respuesta text,
  respondida_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ==================== NOTICIAS / COMUNICADOS / MURO ====================
CREATE TABLE comunicados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid REFERENCES consorcios(id) ON DELETE CASCADE,   -- NULL = todos los consorcios
  seccion text NOT NULL DEFAULT 'comunicados' CHECK (seccion IN ('novedades','comunicados','muro')),
  tipo text NOT NULL DEFAULT 'general' CHECK (tipo IN ('general','urgente','mantenimiento','asamblea','administrativo')),
  titulo text NOT NULL,
  contenido text NOT NULL,
  fijado boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  fecha_publicacion date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- ==================== MANTENIMIENTOS Y CONTROLES ====================
CREATE TABLE mantenimiento_tipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  periodicidad_dias integer NOT NULL DEFAULT 30
);
INSERT INTO mantenimiento_tipos (nombre, periodicidad_dias) VALUES
  ('Ascensores (conservación mensual)', 30), ('Matafuegos / extintores', 365),
  ('Limpieza de tanques de agua', 180), ('Fumigación / control de plagas', 90),
  ('Instalación de gas', 365), ('Bombas de agua', 90), ('Grupo electrógeno', 90),
  ('Porteros eléctricos', 180), ('Desagües y cañerías', 180)
ON CONFLICT DO NOTHING;

CREATE TABLE mantenimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  tipo_id uuid REFERENCES mantenimiento_tipos(id) ON DELETE SET NULL,
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  descripcion text,
  ultimo_mnt date,
  vencimiento date NOT NULL,
  recurrente boolean NOT NULL DEFAULT true,
  periodicidad_dias integer NOT NULL DEFAULT 30,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_mnt_consorcio ON mantenimientos(consorcio_id);
CREATE INDEX idx_mnt_vencimiento ON mantenimientos(vencimiento);

-- ==================== COMPRAS ====================
CREATE TABLE pedidos_compra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  numero serial,
  descripcion text NOT NULL,
  detalle text,
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cotizando','adjudicado','cerrado','anulado')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE cotizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  monto numeric(14,2) NOT NULL DEFAULT 0,
  plazo_dias integer,
  notas text,
  elegida boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE ordenes_compra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  cotizacion_id uuid REFERENCES cotizaciones(id) ON DELETE SET NULL,
  numero serial,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  estado text NOT NULL DEFAULT 'emitida' CHECK (estado IN ('emitida','recibida','facturada','anulada')),
  created_at timestamptz DEFAULT now()
);

-- ==================== SUELDOS ====================
CREATE TABLE empleados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  cuil text,
  cargo text NOT NULL DEFAULT 'encargado' CHECK (cargo IN ('encargado','ayudante','suplente','personal_limpieza','vigilancia','otro')),
  categoria text,                        -- categoría de escalafón SUTERH
  sueldo_basico numeric(14,2) NOT NULL DEFAULT 0,
  antiguedad_fecha date,                 -- fecha de ingreso (plus antigüedad 1%/año)
  vive_en_edificio boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE sueldo_liquidaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  periodo text NOT NULL,                 -- YYYY-MM
  basico numeric(14,2) NOT NULL DEFAULT 0,
  antiguedad numeric(14,2) NOT NULL DEFAULT 0,
  adicionales numeric(14,2) NOT NULL DEFAULT 0,
  no_remunerativo numeric(14,2) NOT NULL DEFAULT 0,
  bruto numeric(14,2) NOT NULL DEFAULT 0,
  aportes numeric(14,2) NOT NULL DEFAULT 0,          -- retenciones al empleado (17%)
  neto numeric(14,2) NOT NULL DEFAULT 0,
  contribuciones numeric(14,2) NOT NULL DEFAULT 0,   -- cargas patronales
  costo_total numeric(14,2) NOT NULL DEFAULT 0,      -- bruto + contribuciones + no remunerativo
  estado text NOT NULL DEFAULT 'preliquidada' CHECK (estado IN ('preliquidada','liquidada','pagada')),
  gasto_id uuid REFERENCES gastos(id) ON DELETE SET NULL,  -- gasto generado al pasar a expensas
  created_at timestamptz DEFAULT now(),
  UNIQUE (empleado_id, periodo)
);

-- ==================== CONTABILIDAD ====================
CREATE TABLE cuentas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'caja' CHECK (tipo IN ('caja','banco')),
  banco text, cbu text,
  saldo_inicial numeric(14,2) NOT NULL DEFAULT 0,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  cuenta_id uuid REFERENCES cuentas(id) ON DELETE SET NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  tipo text NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  concepto text NOT NULL,
  monto numeric(14,2) NOT NULL CHECK (monto >= 0),
  origen text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual','pago','orden_pago','sueldo')),
  origen_id uuid,
  conciliado boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_mov_consorcio ON movimientos(consorcio_id);
CREATE INDEX idx_mov_fecha ON movimientos(fecha);

CREATE TABLE retenciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  tipo text NOT NULL DEFAULT 'ganancias' CHECK (tipo IN ('ganancias','iibb','suss','iva')),
  monto numeric(14,2) NOT NULL DEFAULT 0,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  certificado text,
  created_at timestamptz DEFAULT now()
);

-- ==================== CALENDARIO ====================
CREATE TABLE eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid REFERENCES consorcios(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  tipo text NOT NULL DEFAULT 'otro' CHECK (tipo IN ('asamblea','visita','vencimiento','recordatorio','otro')),
  fecha date NOT NULL,
  hora time,
  notas text,
  created_at timestamptz DEFAULT now()
);

-- ==================== ARCHIVOS ====================
CREATE TABLE archivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid REFERENCES consorcios(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  categoria text NOT NULL DEFAULT 'otros' CHECK (categoria IN ('reglamento','actas','planos','seguros','liquidaciones','legales','otros')),
  storage_path text,
  url_externa text,
  subido_por text,
  created_at timestamptz DEFAULT now()
);

-- ==================== TELÉFONOS ÚTILES ====================
CREATE TABLE telefonos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid REFERENCES consorcios(id) ON DELETE CASCADE,   -- NULL = agenda general
  nombre text NOT NULL,
  categoria text NOT NULL DEFAULT 'otros' CHECK (categoria IN ('emergencias','servicios','proveedor','encargado','consejo','otros')),
  telefono text NOT NULL,
  notas text,
  created_at timestamptz DEFAULT now()
);

-- ==================== ENCUESTAS ====================
CREATE TABLE encuestas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descripcion text,
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
  fecha_cierre date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE encuesta_opciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encuesta_id uuid NOT NULL REFERENCES encuestas(id) ON DELETE CASCADE,
  texto text NOT NULL,
  votos integer NOT NULL DEFAULT 0
);

-- ==================== RLS: políticas abiertas (app interna sin login, igual que antes) ====================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'administracion','usuarios','notificaciones','consorcios','unidades','proveedores',
    'proveedor_certificaciones','rubros','liquidaciones','gastos','provisiones','cupones','pagos',
    'ordenes_pago','cheques','planes_pago','facturas_admin','reclamos','reclamo_eventos','consultas',
    'comunicados','mantenimiento_tipos','mantenimientos','pedidos_compra','cotizaciones','ordenes_compra',
    'empleados','sueldo_liquidaciones','cuentas','movimientos','retenciones','eventos','archivos',
    'telefonos','encuestas','encuesta_opciones'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "open_all_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "open_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- Fila inicial de administración
INSERT INTO administracion (nombre) SELECT 'Mi Administración'
WHERE NOT EXISTS (SELECT 1 FROM administracion);

-- Bucket de Storage para archivos adjuntos (reglamentos, certificados, logos)
INSERT INTO storage.buckets (id, name, public) VALUES ('archivos','archivos', true)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "archivos_open_select" ON storage.objects;
CREATE POLICY "archivos_open_select" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'archivos');
DROP POLICY IF EXISTS "archivos_open_insert" ON storage.objects;
CREATE POLICY "archivos_open_insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'archivos');
DROP POLICY IF EXISTS "archivos_open_delete" ON storage.objects;
CREATE POLICY "archivos_open_delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'archivos');

/*
  Módulo "para el contador":
  1. Sueldos completos: parámetros configurables, escala del convenio, adicionales, horas extras, SAC, vacaciones, recibo.
  2. Retenciones automáticas al pagar órdenes de pago (régimen por proveedor).
  3. Rendición anual (no necesita tablas: usa lo existente).
  4. Certificado de deuda (no necesita tablas).
  5. Legajo del consorcio: pólizas y datos bancarios.
*/

-- ==================== Parámetros (clave/valor editables desde la app) ====================
CREATE TABLE IF NOT EXISTS parametros (
  clave text PRIMARY KEY,
  grupo text NOT NULL,
  descripcion text NOT NULL,
  valor numeric(14,4) NOT NULL DEFAULT 0,
  orden int NOT NULL DEFAULT 0
);
ALTER TABLE parametros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_parametros" ON parametros;
CREATE POLICY "admin_all_parametros" ON parametros FOR ALL TO authenticated USING (es_admin()) WITH CHECK (es_admin());

INSERT INTO parametros (clave, grupo, descripcion, valor, orden) VALUES
  -- Aportes del empleado (se descuentan del bruto)
  ('ap_jubilacion',      'aportes', 'Jubilación (SIPA) %',                        11,   1),
  ('ap_ley19032',        'aportes', 'Ley 19.032 (PAMI) %',                         3,   2),
  ('ap_obra_social',     'aportes', 'Obra social %',                                3,   3),
  ('ap_sindicato',       'aportes', 'Cuota sindical SUTERH %',                      2,   4),
  ('ap_fateryh',         'aportes', 'FATERYH / Caja de protección a la familia %',  1,   5),
  -- Contribuciones patronales (las paga el consorcio)
  ('co_sipa',            'contribuciones', 'Jubilación + asignaciones + fondo de empleo %', 18,   1),
  ('co_ley19032',        'contribuciones', 'Ley 19.032 (PAMI) %',                           1.5, 2),
  ('co_obra_social',     'contribuciones', 'Obra social %',                                  6,   3),
  ('co_fateryh',         'contribuciones', 'FATERYH %',                                      2.5, 4),
  ('co_art_pct',         'contribuciones', 'ART % sobre bruto',                               3,   5),
  ('co_art_fijo',        'contribuciones', 'ART cuota fija por empleado ($)',                 0,   6),
  ('co_seguro_vida',     'contribuciones', 'Seguro de vida obligatorio por empleado ($)',     0,   7),
  -- Convenio
  ('cv_antiguedad_pct',  'convenio', 'Antigüedad: % del básico por año',                      1,   1),
  ('cv_horas_mes',       'convenio', 'Horas mensuales para valor hora',                       200, 2),
  ('cv_adic_titulo',     'convenio', 'Adicional por título ($)',                              0,   3),
  ('cv_adic_vidrios',    'convenio', 'Adicional limpieza de vidrios ($)',                     0,   4),
  ('cv_adic_residuos',   'convenio', 'Adicional retiro de residuos ($)',                      0,   5),
  ('cv_adic_jardin',     'convenio', 'Adicional jardín ($)',                                  0,   6),
  ('cv_adic_vivienda',   'convenio', 'Valor vivienda (no remunerativo, si no vive en el edificio) ($)', 0, 7),
  -- Retenciones a proveedores
  ('rt_gan_minimo',      'retenciones', 'Ganancias: monto no sujeto a retención (servicios/locaciones) $', 0, 1),
  ('rt_gan_alic',        'retenciones', 'Ganancias: alícuota por defecto %',                 2,   2),
  ('rt_iibb_alic',       'retenciones', 'IIBB: alícuota por defecto %',                      3,   3),
  ('rt_iibb_minimo',     'retenciones', 'IIBB: monto mínimo de la operación $',              0,   4),
  ('rt_suss_alic',       'retenciones', 'SUSS: alícuota por defecto %',                      2,   5),
  ('rt_suss_minimo',     'retenciones', 'SUSS: monto mínimo de la operación $',              0,   6)
ON CONFLICT (clave) DO NOTHING;

-- ==================== Sueldos ====================
CREATE TABLE IF NOT EXISTS convenio_escalas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL,
  basico numeric(14,2) NOT NULL DEFAULT 0,
  vigencia_desde date NOT NULL DEFAULT CURRENT_DATE,
  notas text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (categoria, vigencia_desde)
);
ALTER TABLE convenio_escalas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_convenio_escalas" ON convenio_escalas;
CREATE POLICY "admin_all_convenio_escalas" ON convenio_escalas FOR ALL TO authenticated USING (es_admin()) WITH CHECK (es_admin());

ALTER TABLE empleados ADD COLUMN IF NOT EXISTS usar_escala boolean NOT NULL DEFAULT false;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS adic_titulo boolean NOT NULL DEFAULT false;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS adic_vidrios boolean NOT NULL DEFAULT false;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS adic_residuos boolean NOT NULL DEFAULT false;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS adic_jardin boolean NOT NULL DEFAULT false;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS obra_social text;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS cbu text;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS fecha_egreso date;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS jornada text NOT NULL DEFAULT 'completa';

ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS horas_50 numeric(8,2) NOT NULL DEFAULT 0;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS horas_100 numeric(8,2) NOT NULL DEFAULT 0;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS horas_extras numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS adic_convenio numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS sac numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS vacaciones numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS dias_vacaciones int NOT NULL DEFAULT 0;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS descuentos numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS detalle jsonb;          -- líneas del recibo (concepto, monto, tipo)
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS observaciones text;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS fecha_pago date;
ALTER TABLE sueldo_liquidaciones ADD COLUMN IF NOT EXISTS recibo_nro serial;

-- ==================== Retenciones ====================
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS condicion_iva text NOT NULL DEFAULT 'ri' CHECK (condicion_iva IN ('ri','monotributo','exento'));
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ret_ganancias boolean NOT NULL DEFAULT false;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ret_ganancias_alic numeric(6,2);
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ret_iibb boolean NOT NULL DEFAULT false;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ret_iibb_alic numeric(6,2);
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ret_suss boolean NOT NULL DEFAULT false;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ret_suss_alic numeric(6,2);

ALTER TABLE ordenes_pago ADD COLUMN IF NOT EXISTS retenciones_total numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE ordenes_pago ADD COLUMN IF NOT EXISTS neto_pagado numeric(14,2);
ALTER TABLE ordenes_pago ADD COLUMN IF NOT EXISTS fecha_pago date;

-- ==================== Legajo del consorcio ====================
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS banco text;
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS cbu text;
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS fecha_asamblea date;      -- última asamblea ordinaria
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS fecha_mandato_hasta date; -- vencimiento del mandato del administrador

CREATE TABLE IF NOT EXISTS consorcio_polizas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'incendio' CHECK (tipo IN ('incendio','art','vida_obligatorio','ascensores','responsabilidad_civil','otro')),
  compania text,
  numero text,
  vencimiento date NOT NULL,
  monto numeric(14,2),
  archivo_path text,
  notas text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE consorcio_polizas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_consorcio_polizas" ON consorcio_polizas;
CREATE POLICY "admin_all_consorcio_polizas" ON consorcio_polizas FOR ALL TO authenticated USING (es_admin()) WITH CHECK (es_admin());

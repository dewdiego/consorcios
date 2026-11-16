/*
  Paridad de funciones, tanda 1:
  ajustes por unidad (cargos, descuentos, quitas, multas, reservas), cobros no identificados, pagos informados por el
  propietario, juicios, infracciones (faltas + multas/apercibimientos con descargo), amenities y reservas,
  reuniones virtuales, invitados y accesos.
  Se puede correr más de una vez.
*/

-- ==================== Ajustes por unidad ====================
CREATE TABLE IF NOT EXISTS ajustes_unidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  liquidacion_id uuid REFERENCES liquidaciones(id) ON DELETE SET NULL,   -- NULL = pendiente: entra en la próxima expensa que se cierre
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  tipo text NOT NULL DEFAULT 'cargo' CHECK (tipo IN ('cargo','descuento','quita_deuda','quita_intereses','multa','reserva','plan')),
  concepto text NOT NULL,
  monto numeric(14,2) NOT NULL DEFAULT 0,          -- siempre positivo; el signo lo da el tipo
  monto_aplicado numeric(14,2),                    -- lo que impactó en el cupón (con signo), se completa al generar cupones
  origen text, origen_id uuid,
  creado_por text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ajustes_consorcio ON ajustes_unidad(consorcio_id, liquidacion_id);
ALTER TABLE cupones ADD COLUMN IF NOT EXISTS otros numeric(14,2) NOT NULL DEFAULT 0;

-- ==================== Cobros no identificados ====================
CREATE TABLE IF NOT EXISTS cobros_no_identificados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  cuenta_id uuid REFERENCES cuentas(id) ON DELETE SET NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  monto numeric(14,2) NOT NULL CHECK (monto > 0),
  metodo text NOT NULL DEFAULT 'transferencia',
  descripcion text,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','identificado')),
  unidad_id uuid REFERENCES unidades(id) ON DELETE SET NULL,
  pago_id uuid REFERENCES pagos(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_origen_check;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_origen_check
  CHECK (origen IN ('manual','pago','orden_pago','sueldo','transferencia','retencion','ajuste','no_identificado'));

-- ==================== Pagos informados por el propietario ====================
CREATE TABLE IF NOT EXISTS pagos_informados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  cupon_id uuid REFERENCES cupones(id) ON DELETE SET NULL,
  fecha date NOT NULL,
  monto numeric(14,2) NOT NULL CHECK (monto > 0),
  metodo text NOT NULL DEFAULT 'transferencia',
  referencia text,
  archivo_path text,
  email text,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  motivo text,
  pago_id uuid REFERENCES pagos(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- ==================== Juicios ====================
CREATE TABLE IF NOT EXISTS juicios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid REFERENCES unidades(id) ON DELETE SET NULL,
  caratula text NOT NULL,
  expediente text, juzgado text, objeto text,
  monto_reclamado numeric(14,2),
  comentario text,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','finalizado')),
  created_at timestamptz DEFAULT now()
);

-- ==================== Infracciones ====================
CREATE TABLE IF NOT EXISTS faltas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid DEFAULT mi_administracion(),
  categoria text, nombre text NOT NULL,
  severidad text NOT NULL DEFAULT 'leve' CHECK (severidad IN ('leve','media','grave')),
  nota text,
  monto_fijo boolean NOT NULL DEFAULT true,
  monto numeric(14,2) NOT NULL DEFAULT 0,
  monto_max numeric(14,2),
  dias_descargo integer NOT NULL DEFAULT 10,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS infracciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  falta_id uuid REFERENCES faltas(id) ON DELETE SET NULL,
  tipo text NOT NULL DEFAULT 'multa' CHECK (tipo IN ('multa','apercibimiento')),
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  descripcion text NOT NULL,
  monto numeric(14,2) NOT NULL DEFAULT 0,
  vence_descargo date,
  estado text NOT NULL DEFAULT 'cargada' CHECK (estado IN ('cargada','notificada','en_revision','confirmada','descartada')),
  notificada_at timestamptz,
  descargo text, descargo_at timestamptz, descargo_por text,
  resolucion text,
  archivo_path text,
  created_at timestamptz DEFAULT now()
);

-- ==================== Amenities y reservas ====================
CREATE TABLE IF NOT EXISTS amenities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  mensaje text,                                   -- reglas de uso, se muestran al reservar
  reservable boolean NOT NULL DEFAULT true,
  max_dia integer NOT NULL DEFAULT 1, max_semana integer NOT NULL DEFAULT 2, max_mes integer NOT NULL DEFAULT 4,
  dias_anticipacion integer NOT NULL DEFAULT 30,  -- con cuántos días de anticipación como máximo se puede reservar
  dias_cancelacion integer NOT NULL DEFAULT 1,    -- hasta cuántos días antes se puede cancelar
  costo numeric(14,2) NOT NULL DEFAULT 0,
  horarios jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{ "dia": 0-6 (0 = domingo), "desde": "10:00", "hasta": "14:00", "cupo": 1 }]
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amenity_id uuid NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  fecha date NOT NULL, desde text NOT NULL, hasta text NOT NULL,
  email text, nombre text,
  costo numeric(14,2) NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','cancelada')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservas_amenity ON reservas(amenity_id, fecha);

-- ==================== Reuniones virtuales ====================
CREATE TABLE IF NOT EXISTS reuniones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  titulo text NOT NULL, descripcion text,
  fecha date NOT NULL, hora text NOT NULL DEFAULT '19:00',
  plataforma text NOT NULL DEFAULT 'meet' CHECK (plataforma IN ('meet','zoom','otra','presencial')),
  link text,
  destinatarios text NOT NULL DEFAULT 'propietarios' CHECK (destinatarios IN ('propietarios','todos','consejo')),
  notificada_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ==================== Invitados y accesos ====================
CREATE TABLE IF NOT EXISTS invitados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid REFERENCES unidades(id) ON DELETE SET NULL,
  nombre text NOT NULL, documento text, patente text, vehiculo text, email text,
  desde date NOT NULL DEFAULT CURRENT_DATE, hasta date,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accesos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  invitado_id uuid NOT NULL REFERENCES invitados(id) ON DELETE CASCADE,
  entrada timestamptz NOT NULL DEFAULT now(),
  salida timestamptz,
  nota text
);

-- ==================== Seguridad: sólo administradores, cada uno lo suyo ====================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ajustes_unidad','cobros_no_identificados','pagos_informados','juicios','infracciones','amenities','reservas','reuniones','invitados','accesos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "admin_all_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "admin_all_%s" ON %I FOR ALL TO authenticated USING (es_admin() AND consorcio_visible(consorcio_id)) WITH CHECK (es_admin() AND consorcio_visible(consorcio_id))', t, t);
  END LOOP;
END $$;
ALTER TABLE faltas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_faltas" ON faltas;
CREATE POLICY "admin_all_faltas" ON faltas FOR ALL TO authenticated USING (adm_visible(administracion_id)) WITH CHECK (adm_visible(administracion_id));

-- ==================== Tanda 2: pago directo de gastos (con partición en dos cuentas) y reglamento ====================
ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_origen_check;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_origen_check
  CHECK (origen IN ('manual','pago','orden_pago','sueldo','transferencia','retencion','ajuste','no_identificado','gasto'));
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS url_reglamento text;   -- link al reglamento de copropiedad: sale con QR en la expensa

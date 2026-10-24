/*
  Contabilidad completa: cuenta predeterminada, transferencias entre cuentas,
  conciliación bancaria por período y retenciones con depósito.
*/

-- Cuentas: una predeterminada por consorcio (ahí caen los cobros/pagos que no indican cuenta)
ALTER TABLE cuentas ADD COLUMN IF NOT EXISTS predeterminada boolean NOT NULL DEFAULT false;
ALTER TABLE cuentas ADD COLUMN IF NOT EXISTS fecha_saldo_inicial date NOT NULL DEFAULT '2000-01-01';
CREATE UNIQUE INDEX IF NOT EXISTS cuentas_predeterminada_unica ON cuentas (consorcio_id) WHERE predeterminada;

-- Movimientos: nuevos orígenes, comprobante y fecha de conciliación
ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_origen_check;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_origen_check
  CHECK (origen IN ('manual','pago','orden_pago','sueldo','transferencia','retencion','ajuste'));
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS comprobante text;
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS fecha_conciliado date;
CREATE INDEX IF NOT EXISTS movimientos_consorcio_fecha ON movimientos (consorcio_id, fecha);

-- Conciliaciones: una por cuenta y período, con el saldo que dice el extracto del banco
CREATE TABLE IF NOT EXISTS conciliaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  cuenta_id uuid NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  periodo text NOT NULL,
  saldo_extracto numeric(14,2),
  cerrada boolean NOT NULL DEFAULT false,
  notas text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (cuenta_id, periodo)
);
ALTER TABLE conciliaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_conciliaciones" ON conciliaciones;
CREATE POLICY "admin_all_conciliaciones" ON conciliaciones FOR ALL TO authenticated USING (es_admin()) WITH CHECK (es_admin());

-- Retenciones: base y alícuota, estado y vínculo con la OP y el egreso del depósito
ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS base numeric(14,2);
ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS alicuota numeric(6,2);
ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','depositada'));
ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS orden_pago_id uuid REFERENCES ordenes_pago(id) ON DELETE SET NULL;
ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS movimiento_id uuid REFERENCES movimientos(id) ON DELETE SET NULL;
ALTER TABLE retenciones ADD COLUMN IF NOT EXISTS depositada_at date;

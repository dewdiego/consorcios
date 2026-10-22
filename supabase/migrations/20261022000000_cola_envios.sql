-- Envío de expensas por mail con cola (Resend, límite diario)

-- PDF de la liquidación que se adjunta a cada mail
ALTER TABLE liquidaciones ADD COLUMN IF NOT EXISTS pdf_path text;

CREATE TABLE IF NOT EXISTS cola_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id uuid NOT NULL REFERENCES liquidaciones(id) ON DELETE CASCADE,
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid REFERENCES unidades(id) ON DELETE SET NULL,
  email text NOT NULL,
  nombre text,
  asunto text NOT NULL,
  html text NOT NULL,
  adjunto_nombre text,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviando','enviado','error')),
  intentos integer NOT NULL DEFAULT 0,
  procesando_at timestamptz,
  error text,
  resend_id text,
  enviado_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (liquidacion_id, unidad_id, email)   -- evita mandar dos veces lo mismo
);
CREATE INDEX IF NOT EXISTS idx_cola_estado ON cola_envios(estado);
CREATE INDEX IF NOT EXISTS idx_cola_liq ON cola_envios(liquidacion_id);

ALTER TABLE cola_envios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "open_all_cola_envios" ON cola_envios;
CREATE POLICY "open_all_cola_envios" ON cola_envios FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

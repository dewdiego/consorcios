-- Comunicados con formato Octavo: número, estado, programación y envío por mail (misma cola que las expensas)

ALTER TABLE comunicados
  ADD COLUMN IF NOT EXISTS numero integer,
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','programado','enviado')),
  ADD COLUMN IF NOT EXISTS etiquetas text,
  ADD COLUMN IF NOT EXISTS destinatarios text NOT NULL DEFAULT 'todos' CHECK (destinatarios IN ('todos','propietarios','inquilinos')),
  ADD COLUMN IF NOT EXISTS programado_at timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_envio timestamptz,
  ADD COLUMN IF NOT EXISTS adjunto_path text;

-- Numerar los comunicados existentes por consorcio
WITH n AS (
  SELECT id, row_number() OVER (PARTITION BY consorcio_id ORDER BY created_at) AS rn FROM comunicados
)
UPDATE comunicados c SET numero = n.rn FROM n WHERE c.id = n.id AND c.numero IS NULL;

-- La cola sirve ahora para liquidaciones y para comunicados
ALTER TABLE cola_envios ALTER COLUMN liquidacion_id DROP NOT NULL;
ALTER TABLE cola_envios
  ADD COLUMN IF NOT EXISTS comunicado_id uuid REFERENCES comunicados(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS adjunto_path text,          -- archivo a adjuntar (bucket "archivos")
  ADD COLUMN IF NOT EXISTS enviar_desde timestamptz;   -- envío programado: no sale antes de esta fecha
CREATE INDEX IF NOT EXISTS idx_cola_com ON cola_envios(comunicado_id);

-- Envíos de liquidaciones ya encolados: tomar el PDF de su liquidación
UPDATE cola_envios c SET adjunto_path = l.pdf_path
FROM liquidaciones l WHERE c.liquidacion_id = l.id AND c.adjunto_path IS NULL;

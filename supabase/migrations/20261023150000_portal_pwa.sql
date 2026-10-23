-- Portal del propietario (PWA) + notificaciones push

-- Dispositivos suscriptos a push (un registro por navegador/celular)
CREATE TABLE IF NOT EXISTS push_suscripciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  activa boolean NOT NULL DEFAULT true,
  ultimo_error text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_email ON push_suscripciones(lower(email));
ALTER TABLE push_suscripciones ENABLE ROW LEVEL SECURITY;
-- Sin políticas abiertas: sólo las Edge Functions (service role) leen/escriben esta tabla

-- Canal de envío en la cola: mail (Resend) o push (PWA)
ALTER TABLE cola_envios
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'mail' CHECK (canal IN ('mail','push')),
  ADD COLUMN IF NOT EXISTS push_titulo text,
  ADD COLUMN IF NOT EXISTS push_cuerpo text,
  ADD COLUMN IF NOT EXISTS push_url text;
ALTER TABLE cola_envios ALTER COLUMN html DROP NOT NULL;
ALTER TABLE cola_envios DROP CONSTRAINT IF EXISTS cola_envios_liquidacion_id_unidad_id_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS cola_envios_unico ON cola_envios (liquidacion_id, unidad_id, email, canal) WHERE liquidacion_id IS NOT NULL;

-- Canal elegido al crear el comunicado
ALTER TABLE comunicados ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'mail' CHECK (canal IN ('mail','push','ambos'));

-- La app de administración sólo necesita saber QUÉ mails tienen la app instalada (no los endpoints)
CREATE OR REPLACE VIEW push_emails AS
  SELECT DISTINCT lower(email) AS email FROM push_suscripciones WHERE activa;
GRANT SELECT ON push_emails TO anon, authenticated;

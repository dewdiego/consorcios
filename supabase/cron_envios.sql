-- Correr DESPUÉS de instalar la función enviar-expensas.
-- Reemplazá TU_PROJECT_REF y TU_ANON_KEY (Project Settings → API).
-- Procesa la cola cada hora; respeta el límite diario configurado en la función.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('procesar-cola-envios') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'procesar-cola-envios');

SELECT cron.schedule(
  'procesar-cola-envios',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://TU_PROJECT_REF.supabase.co/functions/v1/enviar-expensas',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer TU_ANON_KEY"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

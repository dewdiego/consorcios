/*
  Portal de vecinos: datos útiles cargados desde el admin + vista "como lo ve el vecino".
*/
CREATE TABLE IF NOT EXISTS portal_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid REFERENCES consorcios(id) ON DELETE CASCADE,   -- NULL = lo ven todos los consorcios
  titulo text NOT NULL,
  contenido text NOT NULL,
  orden int NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE portal_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_portal_info" ON portal_info;
CREATE POLICY "admin_all_portal_info" ON portal_info FOR ALL TO authenticated USING (es_admin()) WITH CHECK (es_admin());

-- Teléfonos: cuáles se muestran en el portal (por defecto todos menos proveedores)
ALTER TABLE telefonos ADD COLUMN IF NOT EXISTS visible_portal boolean NOT NULL DEFAULT true;
UPDATE telefonos SET visible_portal = false WHERE categoria = 'proveedor';

-- Horario de atención de la administración (se muestra en el portal)
ALTER TABLE administracion ADD COLUMN IF NOT EXISTS horario_atencion text;

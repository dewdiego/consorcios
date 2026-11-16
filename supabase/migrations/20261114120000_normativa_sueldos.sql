/*
  Avisos de cambios de normativa de sueldos (escalas del convenio de encargados, porcentajes de aportes, etc.).
  - normativa_fuentes: páginas oficiales que el sistema revisa solo (función vigilar-normativa). Las administra el superadmin.
  - normativa_avisos: cada cambio detectado o publicado a mano. Lo ven TODAS las administraciones.
      Si trae "escala" (valores por categoría) cada administración la aplica con un botón.
  - normativa_avisos_estado: qué hizo cada administración con cada aviso (aplicado / visto).
*/
CREATE TABLE IF NOT EXISTS normativa_fuentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  url text NOT NULL UNIQUE,
  patron text NOT NULL DEFAULT 'escala',      -- se buscan enlaces cuyo título o dirección contenga esto; vacío = se compara el texto entero de la página
  tipo text NOT NULL DEFAULT 'escala' CHECK (tipo IN ('escala','aportes','otro')),
  activo boolean NOT NULL DEFAULT true,
  vistos jsonb NOT NULL DEFAULT '[]'::jsonb,  -- enlaces ya conocidos (para no avisar dos veces)
  huella text,                                -- huella del texto, cuando no hay patrón
  ultimo_titulo text,
  ultimo_link text,
  ultimo_chequeo timestamptz,
  ultimo_error text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS normativa_avisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL DEFAULT 'escala' CHECK (tipo IN ('escala','aportes','otro')),
  titulo text NOT NULL,
  detalle text,
  fuente_url text,
  fuente_id uuid REFERENCES normativa_fuentes(id) ON DELETE SET NULL,
  origen text NOT NULL DEFAULT 'manual' CHECK (origen IN ('automatico','manual')),
  vigencia_desde date,
  escala jsonb,                               -- [{ "categoria": "...", "basico": 123 }] cuando el superadmin cargó los valores
  valores_at timestamptz,                     -- cuándo se cargaron los valores (para volver a mostrar el aviso a quien ya lo había visto)
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS normativa_avisos_estado (
  aviso_id uuid NOT NULL REFERENCES normativa_avisos(id) ON DELETE CASCADE,
  administracion_id uuid NOT NULL DEFAULT mi_administracion() REFERENCES administracion(id) ON DELETE CASCADE,
  estado text NOT NULL CHECK (estado IN ('aplicado','visto')),
  usuario text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aviso_id, administracion_id)
);

ALTER TABLE normativa_fuentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE normativa_avisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE normativa_avisos_estado ENABLE ROW LEVEL SECURITY;

-- Todos los administradores leen; sólo el superadmin escribe (la función que vigila usa la clave de servicio).
DROP POLICY IF EXISTS "leer_normativa_fuentes" ON normativa_fuentes;
CREATE POLICY "leer_normativa_fuentes" ON normativa_fuentes FOR SELECT TO authenticated USING (es_admin());
DROP POLICY IF EXISTS "super_normativa_fuentes" ON normativa_fuentes;
CREATE POLICY "super_normativa_fuentes" ON normativa_fuentes FOR ALL TO authenticated USING (tiene_superadmin()) WITH CHECK (tiene_superadmin());
DROP POLICY IF EXISTS "leer_normativa_avisos" ON normativa_avisos;
CREATE POLICY "leer_normativa_avisos" ON normativa_avisos FOR SELECT TO authenticated USING (es_admin());
DROP POLICY IF EXISTS "super_normativa_avisos" ON normativa_avisos;
CREATE POLICY "super_normativa_avisos" ON normativa_avisos FOR ALL TO authenticated USING (tiene_superadmin()) WITH CHECK (tiene_superadmin());
DROP POLICY IF EXISTS "adm_normativa_estado" ON normativa_avisos_estado;
CREATE POLICY "adm_normativa_estado" ON normativa_avisos_estado FOR ALL TO authenticated USING (adm_visible(administracion_id)) WITH CHECK (adm_visible(administracion_id));

-- Fuente inicial: novedades de SUTERH, donde publica cada "Nueva Escala Salarial <mes> <año>"
INSERT INTO normativa_fuentes (nombre, url, patron, tipo)
VALUES ('SUTERH · escalas salariales', 'https://suterh.org.ar/category/destacadasnotas/', 'escala', 'escala')
ON CONFLICT (url) DO NOTHING;

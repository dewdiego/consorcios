/*
  MULTI-ADMINISTRACIÓN
  Cada administradora (fila de `administracion`) ve sólo sus consorcios y todo lo que cuelga de ellos.
  - usuarios.administracion_id: a qué administradora pertenece cada operador.
  - usuarios.superadmin: ve y puede todo (Diego).
  - consorcios.administracion_id (y las tablas "sueltas": proveedores, comunicados, teléfonos, eventos, archivos,
    facturas, notificaciones, info del portal, escalas) se completa solo con la administración del usuario logueado.
  - Las políticas RLS filtran por eso en todas las tablas.

  ANTES DE CORRER: no hace falta nada. Lo existente queda asignado a la administración actual (la única fila
  de `administracion`), y los mails de SUPERADMINS (abajo) quedan con permiso total. Revisá esa lista.
*/

-- ==================== 1. Columnas ====================
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS administracion_id uuid REFERENCES administracion(id) ON DELETE RESTRICT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS superadmin boolean NOT NULL DEFAULT false;
ALTER TABLE administracion ADD COLUMN IF NOT EXISTS activa boolean NOT NULL DEFAULT true;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consorcios','proveedores','comunicados','telefonos','eventos','archivos','facturas_admin','notificaciones','portal_info','convenio_escalas'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS administracion_id uuid REFERENCES administracion(id) ON DELETE CASCADE', t);
  END LOOP;
END $$;

-- ==================== 2. Datos existentes → administración actual ====================
DO $$
DECLARE a uuid; t text;
BEGIN
  SELECT id INTO a FROM administracion ORDER BY created_at LIMIT 1;
  IF a IS NULL THEN INSERT INTO administracion (nombre) VALUES ('Mi Administración') RETURNING id INTO a; END IF;
  FOREACH t IN ARRAY ARRAY['usuarios','consorcios','proveedores','comunicados','telefonos','eventos','archivos','facturas_admin','notificaciones','portal_info','convenio_escalas'] LOOP
    EXECUTE format('UPDATE %I SET administracion_id = $1 WHERE administracion_id IS NULL', t) USING a;
  END LOOP;
END $$;

-- SUPERADMINS: permiso total sobre todas las administraciones
UPDATE usuarios SET superadmin = true, rol = 'admin' WHERE lower(email) IN ('dwainer@dypsa.com', 'dewdiego@gmail.com');

-- ==================== 3. Funciones de contexto ====================
CREATE OR REPLACE FUNCTION mi_administracion() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.administracion_id FROM usuarios u
  WHERE lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND u.activo LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION es_superadmin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios u WHERE lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND u.activo AND u.superadmin);
$$;
-- ¿El consorcio es de mi administración (o soy superadmin)?
CREATE OR REPLACE FUNCTION consorcio_visible(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT es_superadmin() OR (cid IS NULL AND es_admin()) OR EXISTS (SELECT 1 FROM consorcios c WHERE c.id = cid AND c.administracion_id = mi_administracion());
$$;
-- ¿La fila (con administracion_id) es de mi administración?
CREATE OR REPLACE FUNCTION adm_visible(aid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT es_admin() AND (es_superadmin() OR aid = mi_administracion());
$$;
GRANT EXECUTE ON FUNCTION mi_administracion(), es_superadmin(), consorcio_visible(uuid), adm_visible(uuid) TO anon, authenticated;

-- ==================== 4. Defaults: lo nuevo nace en mi administración ====================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consorcios','proveedores','comunicados','telefonos','eventos','archivos','facturas_admin','notificaciones','portal_info','convenio_escalas'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN administracion_id SET DEFAULT mi_administracion()', t);
  END LOOP;
END $$;
ALTER TABLE usuarios ALTER COLUMN administracion_id SET DEFAULT mi_administracion();
-- Las escalas eran únicas por categoría+fecha en todo el sistema; ahora por administración
ALTER TABLE convenio_escalas DROP CONSTRAINT IF EXISTS convenio_escalas_categoria_vigencia_desde_key;
CREATE UNIQUE INDEX IF NOT EXISTS convenio_escalas_unicas ON convenio_escalas (administracion_id, categoria, vigencia_desde);

-- ==================== 5. Políticas ====================
-- Helper para no repetir
CREATE OR REPLACE FUNCTION _politica(tabla text, cond text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
  EXECUTE format('DROP POLICY IF EXISTS "open_all_%s" ON %I', tabla, tabla);
  EXECUTE format('DROP POLICY IF EXISTS "admin_all_%s" ON %I', tabla, tabla);
  EXECUTE format('CREATE POLICY "admin_all_%s" ON %I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', tabla, tabla, cond, cond);
END $$;

-- Mi propia administración (sólo la fila propia; superadmin todas)
SELECT _politica('administracion', 'adm_visible(id)');
-- Tablas con administracion_id
SELECT _politica(t, 'adm_visible(administracion_id)') FROM unnest(ARRAY['usuarios','consorcios','proveedores','comunicados','telefonos','eventos','archivos','facturas_admin','notificaciones','portal_info','convenio_escalas']) AS t;
-- Tablas que cuelgan de un consorcio
SELECT _politica(t, 'es_admin() AND consorcio_visible(consorcio_id)') FROM unnest(ARRAY[
  'unidades','liquidaciones','gastos','provisiones','cupones','pagos','ordenes_pago','cheques','planes_pago','reclamos','consultas',
  'mantenimientos','pedidos_compra','empleados','sueldo_liquidaciones','cuentas','movimientos','retenciones','encuestas','cola_envios',
  'conciliaciones','consorcio_polizas']) AS t;
-- Tablas hijas (sin consorcio_id directo)
SELECT _politica('reclamo_eventos', 'es_admin() AND EXISTS (SELECT 1 FROM reclamos r WHERE r.id = reclamo_id AND consorcio_visible(r.consorcio_id))');
SELECT _politica('encuesta_opciones', 'es_admin() AND EXISTS (SELECT 1 FROM encuestas e WHERE e.id = encuesta_id AND consorcio_visible(e.consorcio_id))');
SELECT _politica('cotizaciones', 'es_admin() AND EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id = pedido_id AND consorcio_visible(p.consorcio_id))');
SELECT _politica('ordenes_compra', 'es_admin() AND EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id = pedido_id AND consorcio_visible(p.consorcio_id))');
SELECT _politica('proveedor_certificaciones', 'es_admin() AND EXISTS (SELECT 1 FROM proveedores p WHERE p.id = proveedor_id AND adm_visible(p.administracion_id))');
-- Compartidas entre todas las administraciones (catálogos y parámetros legales)
SELECT _politica(t, 'es_admin()') FROM unnest(ARRAY['rubros','mantenimiento_tipos','parametros']) AS t;
DROP FUNCTION _politica(text, text);

-- Vista de mails con la app: sólo los de mis unidades
DROP VIEW IF EXISTS push_emails;
CREATE VIEW push_emails AS
  SELECT DISTINCT lower(p.email) AS email FROM push_suscripciones p
  WHERE p.activa AND es_admin() AND (es_superadmin() OR EXISTS (
    SELECT 1 FROM unidades u JOIN consorcios c ON c.id = u.consorcio_id
    WHERE c.administracion_id = mi_administracion() AND (lower(u.propietario_email) = lower(p.email) OR lower(u.inquilino_email) = lower(p.email))));
REVOKE ALL ON push_emails FROM anon;
GRANT SELECT ON push_emails TO authenticated;

-- Control
SELECT a.nombre AS administracion, u.email, u.rol, u.superadmin, u.activo,
       (SELECT count(*) FROM consorcios c WHERE c.administracion_id = a.id) AS consorcios
FROM usuarios u JOIN administracion a ON a.id = u.administracion_id ORDER BY a.nombre, u.email;

-- ==================== 6. Superadmin: "trabajar como" una administración ====================
-- ver_todo = true → ve todas las administraciones mezcladas. false → se comporta como un admin de `administracion_id`
-- (ve sólo eso y lo que carga nace ahí). Se cambia desde el selector de la barra superior.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ver_todo boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION es_superadmin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios u WHERE lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND u.activo AND u.superadmin AND u.ver_todo);
$$;
-- Tiene el flag de superadmin (para gestionar administraciones y usuarios), esté en modo global o no
CREATE OR REPLACE FUNCTION tiene_superadmin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios u WHERE lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND u.activo AND u.superadmin);
$$;
-- Cambia la administración activa del superadmin logueado (NULL = ver todas)
CREATE OR REPLACE FUNCTION cambiar_administracion(aid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT tiene_superadmin() THEN RAISE EXCEPTION 'Sólo un superadmin puede cambiar de administración'; END IF;
  IF aid IS NULL THEN
    UPDATE usuarios SET ver_todo = true WHERE lower(email) = lower(auth.jwt() ->> 'email');
  ELSE
    UPDATE usuarios SET ver_todo = false, administracion_id = aid WHERE lower(email) = lower(auth.jwt() ->> 'email');
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION tiene_superadmin(), cambiar_administracion(uuid) TO authenticated;
-- La lista de administraciones la ve siempre el superadmin (para poder elegir)
DROP POLICY IF EXISTS "admin_all_administracion" ON administracion;
CREATE POLICY "admin_all_administracion" ON administracion FOR ALL TO authenticated USING (tiene_superadmin() OR adm_visible(id)) WITH CHECK (tiene_superadmin() OR adm_visible(id));

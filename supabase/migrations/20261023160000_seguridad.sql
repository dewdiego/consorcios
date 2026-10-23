/*
  Seguridad: cierra el acceso anónimo a la base.
  - Sólo los usuarios que figuran en la tabla `usuarios` (activos) y están logueados pueden leer/escribir.
  - Los vecinos (portal) también se loguean, pero NO figuran en `usuarios`: por eso no pasan estas políticas.
    El portal accede únicamente a través de la función `portal`, que usa la clave de servicio.

  ANTES DE CORRER ESTO:
  1. Authentication → Users → Add user: creá tu usuario (mail + contraseña) y el de cada operador.
  2. Asegurate de que esos mismos mails estén en Mi Administración → Usuarios (activos).
     O insertalos acá: INSERT INTO usuarios (nombre, email, rol) VALUES ('Diego', 'tu@mail.com', 'admin');
  Si no, al cerrar las políticas nadie va a poder entrar.
*/

-- ¿El usuario logueado es un operador de la administración?
CREATE OR REPLACE FUNCTION es_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', '')) AND u.activo
  );
$$;
GRANT EXECUTE ON FUNCTION es_admin() TO anon, authenticated;

-- Reemplaza las políticas abiertas por "sólo administradores logueados"
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'administracion','usuarios','notificaciones','consorcios','unidades','proveedores',
    'proveedor_certificaciones','rubros','liquidaciones','gastos','provisiones','cupones','pagos',
    'ordenes_pago','cheques','planes_pago','facturas_admin','reclamos','reclamo_eventos','consultas',
    'comunicados','mantenimiento_tipos','mantenimientos','pedidos_compra','cotizaciones','ordenes_compra',
    'empleados','sueldo_liquidaciones','cuentas','movimientos','retenciones','eventos','archivos',
    'telefonos','encuestas','encuesta_opciones','cola_envios'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "open_all_%s" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "admin_all_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "admin_all_%s" ON %I FOR ALL TO authenticated USING (es_admin()) WITH CHECK (es_admin())', t, t);
  END LOOP;
END $$;

-- Vista de mails con la app: sólo para administradores
DROP VIEW IF EXISTS push_emails;
CREATE VIEW push_emails AS
  SELECT DISTINCT lower(email) AS email FROM push_suscripciones WHERE activa AND es_admin();
REVOKE ALL ON push_emails FROM anon;
GRANT SELECT ON push_emails TO authenticated;

-- Storage: lectura pública (los PDF se comparten por link), escritura sólo administradores
DROP POLICY IF EXISTS "archivos_open_insert" ON storage.objects;
DROP POLICY IF EXISTS "archivos_open_delete" ON storage.objects;
DROP POLICY IF EXISTS "archivos_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "archivos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "archivos_admin_delete" ON storage.objects;
CREATE POLICY "archivos_admin_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'archivos' AND es_admin());
CREATE POLICY "archivos_admin_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'archivos' AND es_admin());
CREATE POLICY "archivos_admin_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'archivos' AND es_admin());

-- Control: lista los usuarios habilitados (tienen que tener cuenta en Authentication → Users)
SELECT nombre, email, rol, activo FROM usuarios ORDER BY nombre;

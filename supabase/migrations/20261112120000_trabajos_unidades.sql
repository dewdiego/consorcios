/*
  Trabajos realizados en unidades: aviso del administrador al propietario, confirmación del propietario desde el portal,
  y seguimiento de pagos parciales / totales.
*/
CREATE TABLE IF NOT EXISTS trabajos_unidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES consorcios(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  numero serial,
  titulo text NOT NULL,
  descripcion text,
  a_cargo text NOT NULL DEFAULT 'propietario' CHECK (a_cargo IN ('propietario','consorcio','compartido')),
  monto numeric(14,2) NOT NULL DEFAULT 0,          -- lo que debe pagar el propietario
  fecha_aviso date NOT NULL DEFAULT CURRENT_DATE,
  fecha_realizado date,
  estado text NOT NULL DEFAULT 'avisado' CHECK (estado IN ('avisado','realizado','confirmado','observado','cerrado')),
  avisado_at timestamptz,                           -- última notificación al propietario
  confirmado_at timestamptz,
  confirmado_por text,                              -- mail del propietario que confirmó
  observacion_propietario text,
  archivo_path text,                                -- presupuesto / foto / factura
  notas text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trabajos_pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trabajo_id uuid NOT NULL REFERENCES trabajos_unidad(id) ON DELETE CASCADE,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  monto numeric(14,2) NOT NULL,
  metodo text NOT NULL DEFAULT 'transferencia',
  comprobante text,
  notas text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE trabajos_unidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE trabajos_pagos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all_trabajos_unidad" ON trabajos_unidad;
CREATE POLICY "admin_all_trabajos_unidad" ON trabajos_unidad FOR ALL TO authenticated USING (es_admin() AND consorcio_visible(consorcio_id)) WITH CHECK (es_admin() AND consorcio_visible(consorcio_id));
DROP POLICY IF EXISTS "admin_all_trabajos_pagos" ON trabajos_pagos;
CREATE POLICY "admin_all_trabajos_pagos" ON trabajos_pagos FOR ALL TO authenticated
  USING (es_admin() AND EXISTS (SELECT 1 FROM trabajos_unidad t WHERE t.id = trabajo_id AND consorcio_visible(t.consorcio_id)))
  WITH CHECK (es_admin() AND EXISTS (SELECT 1 FROM trabajos_unidad t WHERE t.id = trabajo_id AND consorcio_visible(t.consorcio_id)));

-- La cola de envíos acepta avisos sueltos (sin liquidación ni comunicado) vinculados a un trabajo
ALTER TABLE cola_envios ADD COLUMN IF NOT EXISTS trabajo_id uuid REFERENCES trabajos_unidad(id) ON DELETE CASCADE;

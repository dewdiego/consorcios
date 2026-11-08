/*
  Configuración del módulo de expensas (como Octavo): monto fijo a deudores, redondeo, vencimientos en días no hábiles,
  carpeta externa de comprobantes. Facturas adjuntas a cada gasto, visibles en el portal del vecino.
*/
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS monto_fijo_deudores numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS redondeo text NOT NULL DEFAULT 'ninguno' CHECK (redondeo IN ('ninguno','unidad','decena','centena'));
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS venc_no_habil text NOT NULL DEFAULT 'no_modificar' CHECK (venc_no_habil IN ('no_modificar','siguiente_habil','anterior_habil'));
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS url_comprobantes text;          -- carpeta de Drive con las facturas (sale en el portal y como QR)
ALTER TABLE consorcios ADD COLUMN IF NOT EXISTS mostrar_facturas_portal boolean NOT NULL DEFAULT true;

ALTER TABLE gastos ADD COLUMN IF NOT EXISTS archivo_path text;                 -- factura escaneada (storage: facturas/{consorcio}/...)

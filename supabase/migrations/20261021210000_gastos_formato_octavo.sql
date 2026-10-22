-- Gasto con formato Octavo: importe repartido en A/B/C/D + datos del comprobante
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS monto_a numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_b numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_c numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_d numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS periodo_facturado text,
  ADD COLUMN IF NOT EXISTS tipo_comprobante text NOT NULL DEFAULT 'Factura A',
  ADD COLUMN IF NOT EXISTS recurrente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extraordinario boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notas text;

-- Gastos ya cargados: pasar el monto a la columna de su categoría
UPDATE gastos SET
  monto_a = CASE WHEN categoria = 'A' THEN monto ELSE 0 END,
  monto_b = CASE WHEN categoria = 'B' THEN monto ELSE 0 END,
  monto_c = CASE WHEN categoria = 'C' THEN monto ELSE 0 END,
  monto_d = CASE WHEN categoria = 'D' THEN monto ELSE 0 END
WHERE monto_a + monto_b + monto_c + monto_d = 0;

-- Mantiene monto/categoría y monto_a..d siempre consistentes
-- (los gastos automáticos — provisiones, sueldos, compras — siguen mandando categoria + monto)
CREATE OR REPLACE FUNCTION gastos_sync_montos() RETURNS trigger AS $$
BEGIN
  IF COALESCE(NEW.monto_a,0) + COALESCE(NEW.monto_b,0) + COALESCE(NEW.monto_c,0) + COALESCE(NEW.monto_d,0) = 0 THEN
    NEW.monto_a := CASE WHEN NEW.categoria = 'A' THEN NEW.monto ELSE 0 END;
    NEW.monto_b := CASE WHEN NEW.categoria = 'B' THEN NEW.monto ELSE 0 END;
    NEW.monto_c := CASE WHEN NEW.categoria = 'C' THEN NEW.monto ELSE 0 END;
    NEW.monto_d := CASE WHEN NEW.categoria = 'D' THEN NEW.monto ELSE 0 END;
  ELSE
    NEW.monto := NEW.monto_a + NEW.monto_b + NEW.monto_c + NEW.monto_d;
    NEW.categoria := CASE WHEN NEW.monto_a > 0 THEN 'A' WHEN NEW.monto_b > 0 THEN 'B' WHEN NEW.monto_c > 0 THEN 'C' ELSE 'D' END;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gastos_sync ON gastos;
CREATE TRIGGER trg_gastos_sync BEFORE INSERT OR UPDATE ON gastos
  FOR EACH ROW EXECUTE FUNCTION gastos_sync_montos();

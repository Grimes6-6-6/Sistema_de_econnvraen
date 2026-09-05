DROP INDEX IF EXISTS encomiendas_metodo_pago_fecha_idx;
DROP INDEX IF EXISTS boletos_metodo_pago_fecha_idx;

ALTER TABLE encomiendas
  DROP CONSTRAINT IF EXISTS encomiendas_referencia_pago_check,
  DROP CONSTRAINT IF EXISTS encomiendas_metodo_pago_check,
  DROP COLUMN IF EXISTS referencia_pago,
  DROP COLUMN IF EXISTS metodo_pago;

ALTER TABLE boletos
  DROP CONSTRAINT IF EXISTS boletos_referencia_pago_check,
  DROP CONSTRAINT IF EXISTS boletos_metodo_pago_check,
  DROP COLUMN IF EXISTS referencia_pago,
  DROP COLUMN IF EXISTS metodo_pago;

ALTER TABLE boletos
  ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20) NOT NULL DEFAULT 'EFECTIVO',
  ADD COLUMN IF NOT EXISTS referencia_pago VARCHAR(80);

ALTER TABLE encomiendas
  ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20) NOT NULL DEFAULT 'EFECTIVO',
  ADD COLUMN IF NOT EXISTS referencia_pago VARCHAR(80);

ALTER TABLE boletos
  DROP CONSTRAINT IF EXISTS boletos_metodo_pago_check,
  DROP CONSTRAINT IF EXISTS boletos_referencia_pago_check;

ALTER TABLE boletos
  ADD CONSTRAINT boletos_metodo_pago_check
    CHECK (metodo_pago IN ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA')),
  ADD CONSTRAINT boletos_referencia_pago_check
    CHECK (
      metodo_pago = 'EFECTIVO'
      OR NULLIF(BTRIM(referencia_pago), '') IS NOT NULL
    );

ALTER TABLE encomiendas
  DROP CONSTRAINT IF EXISTS encomiendas_metodo_pago_check,
  DROP CONSTRAINT IF EXISTS encomiendas_referencia_pago_check;

ALTER TABLE encomiendas
  ADD CONSTRAINT encomiendas_metodo_pago_check
    CHECK (metodo_pago IN ('EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'TARJETA')),
  ADD CONSTRAINT encomiendas_referencia_pago_check
    CHECK (
      metodo_pago = 'EFECTIVO'
      OR NULLIF(BTRIM(referencia_pago), '') IS NOT NULL
    );

CREATE INDEX IF NOT EXISTS boletos_metodo_pago_fecha_idx
  ON boletos (metodo_pago, fecha_emision DESC);

CREATE INDEX IF NOT EXISTS encomiendas_metodo_pago_fecha_idx
  ON encomiendas (metodo_pago, fecha_registro DESC);

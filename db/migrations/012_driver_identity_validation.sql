ALTER TABLE conductores
  ADD COLUMN IF NOT EXISTS identidad_estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN IF NOT EXISTS identidad_observacion VARCHAR(300),
  ADD COLUMN IF NOT EXISTS identidad_verificada_por INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS identidad_verificada_at TIMESTAMPTZ;

ALTER TABLE conductores
  DROP CONSTRAINT IF EXISTS conductores_identidad_estado_check;

ALTER TABLE conductores
  ADD CONSTRAINT conductores_identidad_estado_check
    CHECK (identidad_estado IN ('PENDIENTE', 'VERIFICADA', 'OBSERVADA'));

ALTER TABLE documentos_operativos
  DROP CONSTRAINT IF EXISTS documentos_tipo_check;

ALTER TABLE documentos_operativos
  ADD CONSTRAINT documentos_tipo_check CHECK (
    tipo_documento IN (
      'DNI', 'LICENCIA', 'SOAT', 'CITV', 'TUC', 'TARJETA_PROPIEDAD',
      'ANTECEDENTES', 'SALUD', 'OTRO'
    )
  );

CREATE INDEX IF NOT EXISTS conductores_identidad_estado_idx
  ON conductores (identidad_estado, id_agencia_base, id_conductor);

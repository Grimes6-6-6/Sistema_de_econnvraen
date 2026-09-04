ALTER TABLE documentos_operativos
  ADD COLUMN IF NOT EXISTS origen_registro VARCHAR(12) NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN IF NOT EXISTS archivo_nombre VARCHAR(180),
  ADD COLUMN IF NOT EXISTS archivo_mime VARCHAR(50),
  ADD COLUMN IF NOT EXISTS archivo_tamano INTEGER,
  ADD COLUMN IF NOT EXISTS archivo_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS archivo_contenido BYTEA,
  ADD COLUMN IF NOT EXISTS revisado_por INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revisado_at TIMESTAMPTZ;

ALTER TABLE documentos_operativos
  DROP CONSTRAINT IF EXISTS documentos_estado_check;

ALTER TABLE documentos_operativos
  ADD CONSTRAINT documentos_estado_check
    CHECK (estado IN ('PENDIENTE', 'VIGENTE', 'POR_VENCER', 'VENCIDO', 'OBSERVADO'));

ALTER TABLE documentos_operativos
  DROP CONSTRAINT IF EXISTS documentos_origen_check,
  DROP CONSTRAINT IF EXISTS documentos_archivo_check;

ALTER TABLE documentos_operativos
  ADD CONSTRAINT documentos_origen_check
    CHECK (origen_registro IN ('ADMIN', 'CONDUCTOR')),
  ADD CONSTRAINT documentos_archivo_check CHECK (
    (
      archivo_nombre IS NULL AND archivo_mime IS NULL AND archivo_tamano IS NULL
      AND archivo_sha256 IS NULL AND archivo_contenido IS NULL
    )
    OR
    (
      archivo_nombre IS NOT NULL AND archivo_mime IS NOT NULL
      AND archivo_tamano BETWEEN 1 AND 3145728
      AND archivo_sha256 ~ '^[0-9a-f]{64}$'
      AND archivo_contenido IS NOT NULL
      AND octet_length(archivo_contenido) = archivo_tamano
    )
  );

CREATE INDEX IF NOT EXISTS documentos_alertas_idx
  ON documentos_operativos (estado, fecha_vencimiento, id_documento DESC);

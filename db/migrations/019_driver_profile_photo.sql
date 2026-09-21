ALTER TABLE conductores
  ADD COLUMN IF NOT EXISTS foto_perfil_contenido BYTEA,
  ADD COLUMN IF NOT EXISTS foto_perfil_actualizada_at TIMESTAMPTZ;

ALTER TABLE conductores
  DROP CONSTRAINT IF EXISTS conductores_foto_perfil_check;

ALTER TABLE conductores
  ADD CONSTRAINT conductores_foto_perfil_check CHECK (
    (
      foto_perfil_contenido IS NULL
      AND foto_perfil_actualizada_at IS NULL
    )
    OR
    (
      foto_perfil_contenido IS NOT NULL
      AND foto_perfil_actualizada_at IS NOT NULL
      AND octet_length(foto_perfil_contenido) BETWEEN 1 AND 1048576
    )
  );

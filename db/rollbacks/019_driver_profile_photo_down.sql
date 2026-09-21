ALTER TABLE conductores
  DROP CONSTRAINT IF EXISTS conductores_foto_perfil_check,
  DROP COLUMN IF EXISTS foto_perfil_contenido,
  DROP COLUMN IF EXISTS foto_perfil_actualizada_at;

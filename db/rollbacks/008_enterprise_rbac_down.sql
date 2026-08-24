DROP TABLE IF EXISTS documentos_operativos;
DROP TABLE IF EXISTS solicitudes_anulacion_boletos;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_temporary_password_check,
  DROP COLUMN IF EXISTS temporary_password_expires_at,
  DROP COLUMN IF EXISTS must_change_password;

UPDATE roles
SET permisos = CASE nombre
  WHEN 'SUPER_ADMIN' THEN '["agencias:*", "usuarios:*", "operaciones:*", "reportes:*"]'::jsonb
  WHEN 'ADMINISTRADOR' THEN '["usuarios:*", "operaciones:*", "reportes:*"]'::jsonb
  WHEN 'OPERADOR' THEN '["boletos:write", "encomiendas:write", "viajes:write", "recojos:write"]'::jsonb
  WHEN 'CONDUCTOR' THEN '["viajes:read:self", "encomiendas:update:self"]'::jsonb
  ELSE permisos
END;

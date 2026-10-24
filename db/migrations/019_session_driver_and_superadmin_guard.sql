CREATE OR REPLACE FUNCTION enforce_session_agency_access()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  user_role VARCHAR(50);
BEGIN
  IF NEW.id_agencia_activa IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role.nombre
  INTO user_role
  FROM usuarios user_account
  JOIN roles role ON role.id_rol = user_account.id_rol
  WHERE user_account.id_usuario = NEW.id_usuario
    AND user_account.estado = 'ACTIVO';

  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1
       FROM agencias agency
       WHERE agency.id_agencia = NEW.id_agencia_activa
         AND agency.estado = 'ACTIVA'
     )
     OR (
       user_role NOT IN ('SUPER_ADMIN', 'CONDUCTOR')
       AND NOT EXISTS (
         SELECT 1
         FROM usuarios_agencias membership
         WHERE membership.id_usuario = NEW.id_usuario
           AND membership.id_agencia = NEW.id_agencia_activa
           AND membership.estado = 'ACTIVO'
       )
     ) THEN
    RAISE EXCEPTION 'El usuario no tiene acceso a la agencia de la sesión.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE sesiones
  ALTER COLUMN id_agencia_activa DROP NOT NULL;

INSERT INTO usuarios_agencias (id_usuario, id_agencia, es_principal, estado)
SELECT u.id_usuario, a.id_agencia, TRUE, 'ACTIVO'
FROM usuarios u
CROSS JOIN LATERAL (
  SELECT id_agencia FROM agencias WHERE estado = 'ACTIVA' ORDER BY id_agencia LIMIT 1
) a
WHERE a.id_agencia IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM usuarios_agencias ua WHERE ua.id_usuario = u.id_usuario
  )
ON CONFLICT (id_usuario, id_agencia) DO NOTHING;

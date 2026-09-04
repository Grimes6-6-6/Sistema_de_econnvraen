ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS sms_mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Protect the existing superadministrator when a valid Peruvian mobile exists.
-- Other accounts remain password-only until an administrator explicitly enables SMS.
UPDATE usuarios account
SET sms_mfa_enabled = TRUE,
    updated_at = NOW()
FROM roles role, personas person
WHERE role.id_rol = account.id_rol
  AND person.id_persona = account.id_persona
  AND role.nombre = 'SUPER_ADMIN'
  AND person.telefono ~ '^9[0-9]{8}$';

CREATE INDEX IF NOT EXISTS usuarios_sms_mfa_enabled_idx
  ON usuarios (id_usuario)
  WHERE sms_mfa_enabled = TRUE;

-- Force accounts whose policy changed to authenticate again under the new flow.
UPDATE sesiones session
SET revoked_at = NOW()
WHERE session.revoked_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM usuarios account
    WHERE account.id_usuario = session.id_usuario
      AND account.sms_mfa_enabled = TRUE
  );

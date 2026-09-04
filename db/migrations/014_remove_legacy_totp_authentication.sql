-- TOTP and recovery codes were retired in favor of optional SMS verification.
-- Keep the generic session verification columns because the SMS flow uses them.
DROP INDEX IF EXISTS mfa_recovery_codes_active_idx;
DROP INDEX IF EXISTS mfa_recovery_codes_hash_unique;
DROP TABLE IF EXISTS mfa_recovery_codes;

ALTER TABLE sesiones
  DROP COLUMN IF EXISTS mfa_setup_secret_encrypted;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_mfa_state_check;

ALTER TABLE usuarios
  DROP COLUMN IF EXISTS mfa_last_used_step,
  DROP COLUMN IF EXISTS mfa_enrolled_at,
  DROP COLUMN IF EXISTS mfa_secret_encrypted,
  DROP COLUMN IF EXISTS mfa_enabled;

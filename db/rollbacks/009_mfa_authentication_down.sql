DROP INDEX IF EXISTS sesiones_mfa_challenge_idx;
DROP INDEX IF EXISTS mfa_recovery_codes_active_idx;
DROP INDEX IF EXISTS mfa_recovery_codes_hash_unique;
DROP TABLE IF EXISTS mfa_recovery_codes;

ALTER TABLE sesiones
  DROP COLUMN IF EXISTS mfa_challenge_expires_at,
  DROP COLUMN IF EXISTS mfa_setup_secret_encrypted,
  DROP COLUMN IF EXISTS mfa_verified_at;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_mfa_state_check;
ALTER TABLE usuarios
  DROP COLUMN IF EXISTS mfa_last_used_step,
  DROP COLUMN IF EXISTS mfa_enrolled_at,
  DROP COLUMN IF EXISTS mfa_secret_encrypted,
  DROP COLUMN IF EXISTS mfa_enabled;

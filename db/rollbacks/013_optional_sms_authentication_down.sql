DROP INDEX IF EXISTS usuarios_sms_mfa_enabled_idx;

ALTER TABLE usuarios
  DROP COLUMN IF EXISTS sms_mfa_enabled;

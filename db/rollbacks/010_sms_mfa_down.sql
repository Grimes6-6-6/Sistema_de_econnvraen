DROP INDEX IF EXISTS sesiones_sms_challenge_idx;

ALTER TABLE sesiones
  DROP CONSTRAINT IF EXISTS sesiones_sms_attempts_check,
  DROP CONSTRAINT IF EXISTS sesiones_sms_code_hash_check,
  DROP COLUMN IF EXISTS sms_attempts,
  DROP COLUMN IF EXISTS sms_expires_at,
  DROP COLUMN IF EXISTS sms_sent_at,
  DROP COLUMN IF EXISTS sms_code_hash;

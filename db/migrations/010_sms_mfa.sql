ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS sms_code_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_attempts SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE sesiones
  DROP CONSTRAINT IF EXISTS sesiones_sms_code_hash_check;
ALTER TABLE sesiones
  ADD CONSTRAINT sesiones_sms_code_hash_check
  CHECK (sms_code_hash IS NULL OR sms_code_hash ~ '^[a-f0-9]{64}$');

ALTER TABLE sesiones
  DROP CONSTRAINT IF EXISTS sesiones_sms_attempts_check;
ALTER TABLE sesiones
  ADD CONSTRAINT sesiones_sms_attempts_check
  CHECK (sms_attempts BETWEEN 0 AND 5);

CREATE INDEX IF NOT EXISTS sesiones_sms_challenge_idx
  ON sesiones (sms_expires_at)
  WHERE revoked_at IS NULL
    AND mfa_verified_at IS NULL
    AND sms_code_hash IS NOT NULL;

import "server-only";

import { randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import type { MfaChallenge } from "@/lib/auth/session";
import {
  completeMfaSession,
  saveMfaSetupSecret,
} from "@/lib/auth/session";
import { parseEntityId } from "@/lib/domain/ids";
import { writeAuditLog } from "@/server/audit";
import { query, withTransaction } from "@/server/db/pool";
import { unauthorized } from "@/server/errors";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  hashRecoveryCode,
} from "./mfa-crypto";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_COUNT = 8;

function totpFor(username: string, base32Secret: string): TOTP {
  return new TOTP({
    issuer: "ECONNVRAE",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(base32Secret),
  });
}

function validateTotp(
  username: string,
  base32Secret: string,
  token: string,
): number | null {
  const now = Date.now();
  const delta = totpFor(username, base32Secret).validate({
    token,
    timestamp: now,
    window: TOTP_WINDOW,
  });
  return delta === null
    ? null
    : Math.floor(now / (TOTP_PERIOD_SECONDS * 1000)) + delta;
}

function createRecoveryCode(): string {
  const bytes = randomBytes(12);
  const characters = Array.from(
    bytes,
    (value) => RECOVERY_ALPHABET[value % RECOVERY_ALPHABET.length],
  ).join("");
  return characters.match(/.{1,4}/g)?.join("-") || characters;
}

async function auditMfaSuccess(
  challenge: MfaChallenge,
  method: "TOTP" | "RECOVERY" | "SETUP",
  ipHash: string,
): Promise<void> {
  await writeAuditLog({
    userId: challenge.userId,
    agencyId: challenge.user.agenciaId
      ? parseEntityId(challenge.user.agenciaId, "A")
      : null,
    action: "AUTH_LOGIN_SUCCEEDED",
    entity: "usuario",
    entityId: challenge.user.id,
    metadata: { secondFactor: method },
    ipHash,
  });
}

export async function beginMfaSetup(challenge: MfaChallenge): Promise<{
  qrCodeDataUrl: string;
  manualKey: string;
}> {
  if (challenge.mfaEnabled) {
    throw unauthorized("La cuenta ya tiene configurada la autenticación en dos pasos.");
  }

  let base32Secret: string;
  if (challenge.mfaSetupSecretEncrypted) {
    base32Secret = decryptMfaSecret(challenge.mfaSetupSecretEncrypted);
  } else {
    base32Secret = new Secret({ size: 20 }).base32;
    await saveMfaSetupSecret(challenge, encryptMfaSecret(base32Secret));
  }

  const uri = totpFor(challenge.user.username, base32Secret).toString();
  return {
    qrCodeDataUrl: await QRCode.toDataURL(uri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    }),
    manualKey: base32Secret.match(/.{1,4}/g)?.join(" ") || base32Secret,
  };
}

export async function confirmMfaSetup(
  challenge: MfaChallenge,
  token: string,
  ipHash: string,
): Promise<string[]> {
  if (challenge.mfaEnabled || !challenge.mfaSetupSecretEncrypted) {
    throw unauthorized("La configuración venció. Inicia sesión nuevamente.");
  }

  const base32Secret = decryptMfaSecret(challenge.mfaSetupSecretEncrypted);
  const usedStep = validateTotp(challenge.user.username, base32Secret, token);
  if (usedStep === null) {
    await writeAuditLog({
      userId: challenge.userId,
      agencyId: challenge.user.agenciaId
        ? parseEntityId(challenge.user.agenciaId, "A")
        : null,
      action: "AUTH_MFA_FAILED",
      entity: "usuario",
      entityId: challenge.user.id,
      metadata: { mode: "SETUP" },
      ipHash,
    });
    throw unauthorized("El código de verificación no es correcto o ya venció.");
  }

  const recoveryCodes = Array.from(
    { length: RECOVERY_CODE_COUNT },
    createRecoveryCode,
  );
  const encryptedSecret = encryptMfaSecret(base32Secret);

  await withTransaction(async (client) => {
    const activated = await client.query(
      `UPDATE usuarios
       SET mfa_enabled = TRUE,
           mfa_secret_encrypted = $1,
           mfa_enrolled_at = NOW(),
           mfa_last_used_step = $2,
           last_login_at = NOW(),
           updated_at = NOW()
       WHERE id_usuario = $3
         AND mfa_enabled = FALSE`,
      [encryptedSecret, usedStep, challenge.userId],
    );
    if (!activated.rowCount) {
      throw unauthorized("La configuración ya no está disponible.");
    }

    await client.query(
      "DELETE FROM mfa_recovery_codes WHERE id_usuario = $1",
      [challenge.userId],
    );
    for (const code of recoveryCodes) {
      await client.query(
        `INSERT INTO mfa_recovery_codes (id_usuario, code_hash)
         VALUES ($1, $2)`,
        [challenge.userId, hashRecoveryCode(code)],
      );
    }

    const completed = await client.query(
      `UPDATE sesiones
       SET mfa_verified_at = NOW(),
           mfa_setup_secret_encrypted = NULL,
           mfa_challenge_expires_at = NULL,
           last_seen_at = NOW()
       WHERE token_hash = $1
         AND id_usuario = $2
         AND revoked_at IS NULL
         AND mfa_verified_at IS NULL
         AND mfa_challenge_expires_at > NOW()`,
      [challenge.tokenHash, challenge.userId],
    );
    if (!completed.rowCount) {
      throw unauthorized("La verificación venció. Inicia sesión nuevamente.");
    }
  });

  await auditMfaSuccess(challenge, "SETUP", ipHash);
  return recoveryCodes;
}

async function consumeTotp(
  challenge: MfaChallenge,
  token: string,
): Promise<boolean> {
  if (!challenge.mfaSecretEncrypted) return false;
  const secret = decryptMfaSecret(challenge.mfaSecretEncrypted);
  const usedStep = validateTotp(challenge.user.username, secret, token);
  if (usedStep === null) return false;

  const updated = await query(
    `UPDATE usuarios
     SET mfa_last_used_step = $1,
         updated_at = NOW()
     WHERE id_usuario = $2
       AND mfa_enabled = TRUE
       AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $1)`,
    [usedStep, challenge.userId],
  );
  return Boolean(updated.rowCount);
}

async function consumeRecoveryCode(
  challenge: MfaChallenge,
  code: string,
): Promise<boolean> {
  const updated = await query(
    `UPDATE mfa_recovery_codes
     SET used_at = NOW()
     WHERE id_recovery = (
       SELECT id_recovery
       FROM mfa_recovery_codes
       WHERE id_usuario = $1
         AND code_hash = $2
         AND used_at IS NULL
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id_recovery`,
    [challenge.userId, hashRecoveryCode(code)],
  );
  return Boolean(updated.rowCount);
}

export async function verifyMfaChallenge(
  challenge: MfaChallenge,
  code: string,
  ipHash: string,
): Promise<"TOTP" | "RECOVERY"> {
  if (!challenge.mfaEnabled) {
    throw unauthorized("Primero debes configurar la autenticación en dos pasos.");
  }

  const method = /^\d{6}$/.test(code) ? "TOTP" : "RECOVERY";
  const accepted =
    method === "TOTP"
      ? await consumeTotp(challenge, code)
      : await consumeRecoveryCode(challenge, code);
  if (!accepted) {
    await writeAuditLog({
      userId: challenge.userId,
      agencyId: challenge.user.agenciaId
        ? parseEntityId(challenge.user.agenciaId, "A")
        : null,
      action: "AUTH_MFA_FAILED",
      entity: "usuario",
      entityId: challenge.user.id,
      metadata: { method },
      ipHash,
    });
    throw unauthorized("El código de verificación no es correcto o ya fue utilizado.");
  }

  await completeMfaSession(challenge);
  await auditMfaSuccess(challenge, method, ipHash);
  return method;
}

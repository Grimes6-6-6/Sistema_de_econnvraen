import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "@/lib/auth/types";
import type { MfaChallenge } from "@/lib/auth/session";
import { parseEntityId } from "@/lib/domain/ids";
import { writeAuditLog } from "@/server/audit";
import { query } from "@/server/db/pool";
import { AppError, unauthorized } from "@/server/errors";
import { hashPrivateValue } from "@/server/security/request";
import {
  maskMobile,
  normalizePeruMobile,
  sendSmsOtp,
  SmsProviderError,
} from "./sms-provider";

const SMS_CODE_LIFETIME_MINUTES = 5;
const SMS_RESEND_COOLDOWN_SECONDS = 60;
const SMS_MAX_ATTEMPTS = 5;

export interface SmsChallengeTarget {
  tokenHash: string;
  userId: number;
  user: SessionUser;
  phone: string | null;
}

function smsHashKey(): string {
  const pepper = process.env.AUTH_HASH_PEPPER?.trim();
  if (!pepper || pepper.length < 32) {
    throw new Error("AUTH_HASH_PEPPER_NOT_CONFIGURED");
  }
  return pepper;
}

function hashSmsCode(tokenHash: string, code: string): string {
  return createHmac("sha256", smsHashKey())
    .update(`${tokenHash}:${code}`)
    .digest("hex");
}

function secureHashMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

async function auditSms(
  target: SmsChallengeTarget,
  action: "AUTH_MFA_SMS_SENT" | "AUTH_MFA_SMS_FAILED",
  ipHash: string,
  phone: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userId: target.userId,
    agencyId: target.user.agenciaId
      ? parseEntityId(target.user.agenciaId, "A")
      : null,
    action,
    entity: "usuario",
    entityId: target.user.id,
    metadata: {
      destinationHash: hashPrivateValue(phone),
      ...metadata,
    },
    ipHash,
  });
}

export async function issueSmsChallenge(
  target: SmsChallengeTarget,
  ipHash: string,
): Promise<{ maskedPhone: string; retryAfterSeconds: number }> {
  const phone = normalizePeruMobile(target.phone);
  if (!phone) {
    throw new AppError(
      "MFA_PHONE_REQUIRED",
      "Tu cuenta no tiene un celular válido. Solicita al administrador que lo registre.",
      409,
    );
  }

  const reserved = await query<{ sms_sent_at: Date }>(
    `UPDATE sesiones
     SET sms_sent_at = date_trunc('milliseconds', NOW()),
         sms_code_hash = NULL,
         sms_expires_at = NULL,
         sms_attempts = 0
     WHERE token_hash = $1
       AND id_usuario = $2
       AND revoked_at IS NULL
       AND mfa_verified_at IS NULL
       AND mfa_challenge_expires_at > NOW()
       AND (
         sms_sent_at IS NULL
         OR sms_sent_at <= NOW() - ($3::integer * INTERVAL '1 second')
       )
     RETURNING sms_sent_at`,
    [target.tokenHash, target.userId, SMS_RESEND_COOLDOWN_SECONDS],
  );
  const reservationTime = reserved.rows[0]?.sms_sent_at;
  if (!reservationTime) {
    throw new AppError(
      "SMS_COOLDOWN",
      "Espera un minuto antes de solicitar otro código.",
      429,
    );
  }

  try {
    const message = await sendSmsOtp(phone);
    const stored = await query(
      `UPDATE sesiones
       SET sms_code_hash = $1,
           sms_expires_at = NOW() + ($2::integer * INTERVAL '1 minute'),
           mfa_challenge_expires_at = GREATEST(
             mfa_challenge_expires_at,
             NOW() + ($2::integer * INTERVAL '1 minute')
           )
       WHERE token_hash = $3
         AND id_usuario = $4
         AND sms_sent_at = $5
         AND revoked_at IS NULL
         AND mfa_verified_at IS NULL`,
      [
        hashSmsCode(target.tokenHash, message.code),
        SMS_CODE_LIFETIME_MINUTES,
        target.tokenHash,
        target.userId,
        reservationTime,
      ],
    );
    if (!stored.rowCount) throw new Error("SMS_CHALLENGE_SESSION_CHANGED");
    await auditSms(target, "AUTH_MFA_SMS_SENT", ipHash, phone, {
      provider: "TWILIO",
    });
    return {
      maskedPhone: maskMobile(phone),
      retryAfterSeconds: SMS_RESEND_COOLDOWN_SECONDS,
    };
  } catch (error) {
    await query(
      `UPDATE sesiones
       SET sms_sent_at = NULL,
           sms_code_hash = NULL,
           sms_expires_at = NULL,
           sms_attempts = 0
       WHERE token_hash = $1
         AND id_usuario = $2
         AND sms_sent_at = $3
         AND mfa_verified_at IS NULL`,
      [target.tokenHash, target.userId, reservationTime],
    );
    await auditSms(target, "AUTH_MFA_SMS_FAILED", ipHash, phone, {
      provider: "TWILIO",
      providerCode:
        error instanceof SmsProviderError ? error.providerCode : null,
      providerStatus:
        error instanceof SmsProviderError ? error.httpStatus : null,
      failureKind:
        error instanceof SmsProviderError
          ? error.failureKind
          : error instanceof Error &&
              [
                "SMS_PROVIDER_NOT_CONFIGURED",
                "TWILIO_ACCOUNT_SID_INVALID",
                "TWILIO_API_KEY_SID_INVALID",
                "TWILIO_FROM_NUMBER_INVALID",
              ].includes(error.message)
            ? error.message
            : "INTERNAL",
    });
    if (error instanceof AppError) throw error;
    throw new AppError(
      "SMS_DELIVERY_FAILED",
      "No se pudo enviar el SMS. Usa el autenticador o intenta nuevamente.",
      503,
    );
  }
}

export async function verifySmsChallenge(
  challenge: MfaChallenge,
  code: string,
  ipHash: string,
): Promise<void> {
  const expectedHash = challenge.smsCodeHash;
  const actualHash = hashSmsCode(challenge.tokenHash, code);
  const isCurrent =
    expectedHash !== null &&
    challenge.smsExpiresAt !== null &&
    challenge.smsExpiresAt.getTime() > Date.now();
  const accepted =
    isCurrent && secureHashMatch(expectedHash, actualHash);

  if (!accepted) {
    const failed = await query<{ sms_attempts: number }>(
      `UPDATE sesiones
       SET sms_attempts = LEAST(sms_attempts + 1, $1),
           revoked_at = CASE
             WHEN sms_attempts + 1 >= $1 THEN NOW()
             ELSE revoked_at
           END
       WHERE token_hash = $2
         AND id_usuario = $3
         AND revoked_at IS NULL
         AND mfa_verified_at IS NULL
       RETURNING sms_attempts`,
      [SMS_MAX_ATTEMPTS, challenge.tokenHash, challenge.userId],
    );
    await writeAuditLog({
      userId: challenge.userId,
      agencyId: challenge.user.agenciaId
        ? parseEntityId(challenge.user.agenciaId, "A")
        : null,
      action: "AUTH_MFA_FAILED",
      entity: "usuario",
      entityId: challenge.user.id,
      metadata: { method: "SMS" },
      ipHash,
    });
    if ((failed.rows[0]?.sms_attempts || 0) >= SMS_MAX_ATTEMPTS) {
      throw unauthorized("Demasiados códigos incorrectos. Inicia sesión nuevamente.");
    }
    throw unauthorized("El código de verificación no es correcto o ya venció.");
  }

  const completed = await query(
    `UPDATE sesiones
     SET mfa_verified_at = NOW(),
         mfa_challenge_expires_at = NULL,
         mfa_setup_secret_encrypted = NULL,
         sms_code_hash = NULL,
         sms_expires_at = NULL,
         sms_attempts = 0,
         last_seen_at = NOW()
     WHERE token_hash = $1
       AND id_usuario = $2
       AND sms_code_hash = $3
       AND sms_expires_at > NOW()
       AND revoked_at IS NULL
       AND mfa_verified_at IS NULL`,
    [challenge.tokenHash, challenge.userId, expectedHash],
  );
  if (!completed.rowCount) {
    throw unauthorized("El código ya fue utilizado o la verificación venció.");
  }
  await query(
    "UPDATE usuarios SET last_login_at = NOW(), updated_at = NOW() WHERE id_usuario = $1",
    [challenge.userId],
  );
  await writeAuditLog({
    userId: challenge.userId,
    agencyId: challenge.user.agenciaId
      ? parseEntityId(challenge.user.agenciaId, "A")
      : null,
    action: "AUTH_LOGIN_SUCCEEDED",
    entity: "usuario",
    entityId: challenge.user.id,
    metadata: { secondFactor: "SMS" },
    ipHash,
  });
}

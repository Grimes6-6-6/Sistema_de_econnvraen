import { authenticateUser } from "@/lib/auth/users";
import { createSession } from "@/lib/auth/session";
import { toClientSessionUser } from "@/lib/auth/types";
import { parseEntityId } from "@/lib/domain/ids";
import { loginSchema } from "@/lib/validation/schemas";
import { writeAuditLog } from "@/server/audit";
import { issueSmsChallenge } from "@/server/auth/sms-mfa";
import {
  isSmsProviderConfigured,
  normalizePeruMobile,
} from "@/server/auth/sms-provider";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";
import {
  getClientAddressHash,
  hashPrivateValue,
} from "@/server/security/request";
import {
  clearRateLimit,
  consumeRateLimit,
} from "@/server/security/rate-limit";

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const ipHash = getClientAddressHash(request);
    const rateLimitKey = `login:${ipHash}`;
    const rateLimit = await consumeRateLimit(
      rateLimitKey,
      LOGIN_ATTEMPT_LIMIT,
      LOGIN_WINDOW_MS,
    );

    if (!rateLimit.allowed) {
      return noStoreJson(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Demasiados intentos. Intenta nuevamente más tarde.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const credentials = await parseJsonBody(request, loginSchema);
    const authenticated = await authenticateUser(
      credentials.username,
      credentials.password,
    );

    if (!authenticated) {
      await writeAuditLog({
        userId: null,
        action: "AUTH_LOGIN_FAILED",
        entity: "usuario",
        metadata: {
          usernameHash: hashPrivateValue(credentials.username),
        },
        ipHash,
      });

      return noStoreJson(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Usuario o contraseña incorrectos.",
          },
        },
        { status: 401 },
      );
    }

    const { user, mfaEnabled, phone } = authenticated;
    const userId = parseEntityId(user.id, "U");
    const session = await createSession(
      user,
      {
        ipHash,
        userAgent: request.headers.get("user-agent"),
      },
      user.mustChangePassword ? undefined : { mfaChallenge: true },
    );
    if (!user.mustChangePassword) {
      if (isSmsProviderConfigured() && normalizePeruMobile(phone)) {
        try {
          const sms = await issueSmsChallenge(
            { ...session, user, phone },
            ipHash,
          );
          await writeAuditLog({
            userId,
            agencyId: user.agenciaId
              ? parseEntityId(user.agenciaId, "A")
              : null,
            action: "AUTH_MFA_CHALLENGE_STARTED",
            entity: "usuario",
            entityId: user.id,
            metadata: { mode: "SMS" },
            ipHash,
          });
          return noStoreJson({
            nextStep: "SMS_VERIFY" as const,
            maskedPhone: sms.maskedPhone,
            retryAfterSeconds: sms.retryAfterSeconds,
            authenticatorAvailable: mfaEnabled,
          });
        } catch {
          // Twilio trial accounts can only reach verified recipients. Keep the
          // authenticator path available so an external provider cannot lock
          // an employee out of an otherwise valid account.
        }
      }

      const fallbackStep = mfaEnabled ? "MFA_VERIFY" : "MFA_SETUP";
      await writeAuditLog({
        userId,
        agencyId: user.agenciaId
          ? parseEntityId(user.agenciaId, "A")
          : null,
        action: "AUTH_MFA_CHALLENGE_STARTED",
        entity: "usuario",
        entityId: user.id,
        metadata: {
          mode: mfaEnabled ? "VERIFY" : "SETUP",
          smsFallback: true,
        },
        ipHash,
      });
      return noStoreJson({
        nextStep: fallbackStep,
        notice: normalizePeruMobile(phone)
          ? "No se pudo enviar el SMS; utiliza el autenticador para continuar."
          : "Tu cuenta no tiene un celular válido; utiliza el autenticador y solicita al administrador que lo registre.",
      });
    }

    await clearRateLimit(rateLimitKey);

    await writeAuditLog({
      userId,
      agencyId: user.agenciaId
        ? parseEntityId(user.agenciaId, "A")
        : null,
      action: "AUTH_LOGIN_SUCCEEDED",
      entity: "usuario",
      entityId: user.id,
      ipHash,
    });

    return noStoreJson({ user: toClientSessionUser(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { authenticateUser } from "@/lib/auth/users";
import { createSession } from "@/lib/auth/session";
import { parseEntityId } from "@/lib/domain/ids";
import { loginSchema } from "@/lib/validation/schemas";
import { writeAuditLog } from "@/server/audit";
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
    const user = await authenticateUser(
      credentials.username,
      credentials.password,
    );

    if (!user) {
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

    const userId = parseEntityId(user.id, "U");
    await createSession(user, {
      ipHash,
      userAgent: request.headers.get("user-agent"),
    });
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

    return noStoreJson({ user });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { getMfaChallenge } from "@/lib/auth/session";
import { toClientSessionUser } from "@/lib/auth/types";
import { mfaSetupSchema } from "@/lib/validation/schemas";
import {
  beginMfaSetup,
  confirmMfaSetup,
} from "@/server/auth/mfa";
import { unauthorized } from "@/server/errors";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";
import { getClientAddressHash } from "@/server/security/request";
import {
  clearRateLimit,
  consumeRateLimit,
} from "@/server/security/rate-limit";

const MFA_ATTEMPT_LIMIT = 5;
const MFA_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = await parseJsonBody(request, mfaSetupSchema);
    const challenge = await getMfaChallenge();
    if (!challenge) {
      throw unauthorized("La verificación venció. Inicia sesión nuevamente.");
    }

    if (input.action === "start") {
      return noStoreJson({ setup: await beginMfaSetup(challenge) });
    }

    const ipHash = getClientAddressHash(request);
    const rateLimitKey = `mfa:${ipHash}:${challenge.userId}`;
    const rateLimit = await consumeRateLimit(
      rateLimitKey,
      MFA_ATTEMPT_LIMIT,
      MFA_WINDOW_MS,
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

    const recoveryCodes = await confirmMfaSetup(
      challenge,
      input.code,
      ipHash,
    );
    await clearRateLimit(rateLimitKey);
    return noStoreJson({
      user: toClientSessionUser(challenge.user),
      recoveryCodes,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

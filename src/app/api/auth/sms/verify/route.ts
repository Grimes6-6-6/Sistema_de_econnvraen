import { getSmsChallenge } from "@/lib/auth/session";
import { toClientSessionUser } from "@/lib/auth/types";
import { smsVerificationSchema } from "@/lib/validation/schemas";
import { verifySmsChallenge } from "@/server/auth/sms-mfa";
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

const SMS_ATTEMPT_LIMIT = 5;
const SMS_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = await parseJsonBody(request, smsVerificationSchema);
    const challenge = await getSmsChallenge();
    if (!challenge) {
      throw unauthorized("La verificación venció. Inicia sesión nuevamente.");
    }

    const ipHash = getClientAddressHash(request);
    const rateLimitKey = `sms-verify:${ipHash}:${challenge.userId}`;
    const rateLimit = await consumeRateLimit(
      rateLimitKey,
      SMS_ATTEMPT_LIMIT,
      SMS_WINDOW_MS,
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

    await verifySmsChallenge(challenge, input.code, ipHash);
    await clearRateLimit(rateLimitKey);
    await clearRateLimit(`login:${ipHash}`);
    return noStoreJson({ user: toClientSessionUser(challenge.user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

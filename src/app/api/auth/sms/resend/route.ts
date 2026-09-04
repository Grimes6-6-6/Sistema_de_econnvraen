import { getSmsChallenge } from "@/lib/auth/session";
import { issueSmsChallenge } from "@/server/auth/sms-mfa";
import { unauthorized } from "@/server/errors";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
} from "@/server/http";
import { getClientAddressHash } from "@/server/security/request";
import { consumeRateLimit } from "@/server/security/rate-limit";

const SMS_RESEND_LIMIT = 3;
const SMS_RESEND_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const challenge = await getSmsChallenge();
    if (!challenge) {
      throw unauthorized("La verificación venció. Inicia sesión nuevamente.");
    }

    const ipHash = getClientAddressHash(request);
    const rateLimit = await consumeRateLimit(
      `sms-resend:${ipHash}:${challenge.userId}`,
      SMS_RESEND_LIMIT,
      SMS_RESEND_WINDOW_MS,
    );
    if (!rateLimit.allowed) {
      return noStoreJson(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Se solicitaron demasiados códigos. Intenta más tarde.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const result = await issueSmsChallenge(
      {
        tokenHash: challenge.tokenHash,
        userId: challenge.userId,
        user: challenge.user,
        phone: challenge.phone,
      },
      ipHash,
    );
    return noStoreJson(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

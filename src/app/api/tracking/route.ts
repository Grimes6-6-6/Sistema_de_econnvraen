import { publicTrackingSchema } from "@/lib/validation/schemas";
import { findPublicTracking } from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";
import { getClientAddressHash } from "@/server/security/request";
import { consumeRateLimit } from "@/server/security/rate-limit";

const TRACKING_RATE_LIMIT = 20;
const TRACKING_RATE_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const rateLimit = await consumeRateLimit(
      `tracking:${getClientAddressHash(request)}`,
      TRACKING_RATE_LIMIT,
      TRACKING_RATE_WINDOW_MS,
    );
    if (!rateLimit.allowed) {
      return noStoreJson(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Demasiadas consultas. Intenta nuevamente más tarde.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }
    const input = await parseJsonBody(request, publicTrackingSchema);
    const item = await findPublicTracking(
      input.trackingCode,
      input.recipientDniLast4,
    );
    if (!item) {
      return noStoreJson(
        {
          error: {
            code: "TRACKING_NOT_FOUND",
            message: "No encontramos coincidencias para tu búsqueda.",
          },
        },
        { status: 404 },
      );
    }
    return noStoreJson({ item });
  } catch (error) {
    return handleRouteError(error);
  }
}

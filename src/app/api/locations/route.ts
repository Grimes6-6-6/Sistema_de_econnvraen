import { requireApiRole } from "@/lib/auth/authorization";
import { vehicleLocationUpdateSchema } from "@/lib/validation/schemas";
import {
  getVehicleLocations,
  updateVehicleLocation,
} from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";
import { consumeRateLimit } from "@/server/security/rate-limit";

const LOCATION_UPDATE_LIMIT = 240;
const LOCATION_UPDATE_WINDOW_MS = 5 * 60 * 1000;

export async function GET() {
  try {
    const user = await requireApiRole([
      "OPERADOR",
      "CONDUCTOR",
      "ADMINISTRADOR",
    ]);
    const locations = await getVehicleLocations(user);
    return noStoreJson({ locations });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiRole(["CONDUCTOR", "ADMINISTRADOR"]);
    const rateLimit = await consumeRateLimit(
      `location:${user.id}`,
      LOCATION_UPDATE_LIMIT,
      LOCATION_UPDATE_WINDOW_MS,
    );
    if (!rateLimit.allowed) {
      return noStoreJson(
        {
          error: {
            code: "RATE_LIMITED",
            message:
              "Se alcanzó el límite de actualizaciones de ubicación. Intenta nuevamente en unos minutos.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const input = await parseJsonBody(request, vehicleLocationUpdateSchema);
    await updateVehicleLocation(user, input);
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

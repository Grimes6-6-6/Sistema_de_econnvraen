import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { tripInputSchema } from "@/lib/validation/schemas";
import { createTrip } from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.TRIP_MANAGE);
    const input = await parseJsonBody(request, tripInputSchema);
    const item = await createTrip(user, input);
    return noStoreJson({ item }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

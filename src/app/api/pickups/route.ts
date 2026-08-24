import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { pickupInputSchema } from "@/lib/validation/schemas";
import { createPickup } from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.PICKUP_CREATE);
    const input = await parseJsonBody(request, pickupInputSchema);
    const item = await createPickup(user, input);
    return noStoreJson({ item }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

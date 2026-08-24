import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { tripStatusSchema } from "@/lib/validation/schemas";
import { updateTripStatus } from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.TRIP_STATUS_MANAGE);
    const input = await parseJsonBody(request, tripStatusSchema);
    const { id } = await params;
    const item = await updateTripStatus(user, id, input);
    return noStoreJson({ item });
  } catch (error) {
    return handleRouteError(error);
  }
}

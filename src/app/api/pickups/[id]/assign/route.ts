import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { pickupAssignmentSchema } from "@/lib/validation/schemas";
import { assignPickup } from "@/server/data/operations";
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
    const user = await requireApiPermission(PERMISSIONS.PICKUP_ASSIGN);
    const { id } = await params;
    const input = await parseJsonBody(request, pickupAssignmentSchema);
    const item = await assignPickup(user, id, input);
    return noStoreJson({ item });
  } catch (error) {
    return handleRouteError(error);
  }
}

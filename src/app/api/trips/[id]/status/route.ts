import { requireApiRole } from "@/lib/auth/authorization";
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
    const user = await requireApiRole(["CONDUCTOR", "ADMINISTRADOR"]);
    const { id } = await params;
    const input = await parseJsonBody(request, tripStatusSchema);
    const item = await updateTripStatus(user, id, input);
    return noStoreJson({ item });
  } catch (error) {
    return handleRouteError(error);
  }
}

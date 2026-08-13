import { requireApiRole } from "@/lib/auth/authorization";
import { parcelStatusSchema } from "@/lib/validation/schemas";
import { updateParcelStatus } from "@/server/data/operations";
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
    const input = await parseJsonBody(request, parcelStatusSchema);
    const item = await updateParcelStatus(user, id, input);
    return noStoreJson({ item });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { agencyUpdateSchema } from "@/lib/validation/schemas";
import { updateAgency } from "@/server/agencies";
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
    const user = await requireApiPermission(PERMISSIONS.AGENCY_MANAGE);
    const input = await parseJsonBody(request, agencyUpdateSchema);
    const { id } = await params;
    return noStoreJson({ agency: await updateAgency(user, id, input) });
  } catch (error) {
    return handleRouteError(error);
  }
}

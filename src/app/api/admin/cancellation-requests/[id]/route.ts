import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { cancellationResolutionSchema } from "@/lib/validation/schemas";
import { resolveTicketCancellation } from "@/server/admin/cancellations";
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
    const user = await requireApiPermission(PERMISSIONS.TICKET_CANCEL_APPROVE);
    const input = await parseJsonBody(request, cancellationResolutionSchema);
    const { id } = await params;
    return noStoreJson({ request: await resolveTicketCancellation(user, id, input) });
  } catch (error) {
    return handleRouteError(error);
  }
}

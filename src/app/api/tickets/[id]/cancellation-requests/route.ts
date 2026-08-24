import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { cancellationSchema } from "@/lib/validation/schemas";
import { requestTicketCancellation } from "@/server/admin/cancellations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.TICKET_CANCEL_REQUEST);
    const input = await parseJsonBody(request, cancellationSchema);
    const { id } = await params;
    return noStoreJson(
      { request: await requestTicketCancellation(user, id, input) },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ticketInputSchema } from "@/lib/validation/schemas";
import { createTicket } from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.TICKET_SELL);
    const input = await parseJsonBody(request, ticketInputSchema);
    const item = await createTicket(user, input);
    return noStoreJson({ item }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

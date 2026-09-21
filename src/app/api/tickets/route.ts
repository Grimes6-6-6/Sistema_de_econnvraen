import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ticketInputSchema, ticketHistoryQuerySchema } from "@/lib/validation/schemas";
import { createTicket, listTicketHistory } from "@/server/data/operations";
import { badRequest } from "@/server/errors";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function GET(request: Request) {
  try {
    const user = await requireApiPermission(PERMISSIONS.TICKET_SELL);
    const parsed = ticketHistoryQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      throw badRequest("INVALID_TICKET_FILTERS", parsed.error.issues[0]?.message || "Filtros inválidos.");
    }
    return noStoreJson(await listTicketHistory(user, parsed.data));
  } catch (error) {
    return handleRouteError(error);
  }
}

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

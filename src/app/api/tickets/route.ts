import { requireApiRole } from "@/lib/auth/authorization";
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
    const user = await requireApiRole(["OPERADOR", "ADMINISTRADOR"]);
    const input = await parseJsonBody(request, ticketInputSchema);
    const item = await createTicket(user, input);
    return noStoreJson({ item }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

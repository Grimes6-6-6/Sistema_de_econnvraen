import { requireApiRole } from "@/lib/auth/authorization";
import { cancelTicket } from "@/server/data/operations";
import { cancellationSchema } from "@/lib/validation/schemas";
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
    const user = await requireApiRole(["OPERADOR", "ADMINISTRADOR"]);
    const { id } = await params;
    const input = await parseJsonBody(request, cancellationSchema);
    await cancelTicket(user, id, input);
    return noStoreJson({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { requireApiRole } from "@/lib/auth/authorization";
import { cancelTicket } from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
} from "@/server/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiRole(["OPERADOR", "ADMINISTRADOR"]);
    const { id } = await params;
    await cancelTicket(user, id);
    return noStoreJson({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

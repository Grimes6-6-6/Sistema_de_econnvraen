import { requireApiRole } from "@/lib/auth/authorization";
import { switchSessionAgency } from "@/lib/auth/session";
import { toClientSessionUser } from "@/lib/auth/types";
import { agencyIdSchema } from "@/lib/validation/schemas";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    await requireApiRole([
      "ADMINISTRADOR",
      "OPERADOR",
      "CONDUCTOR",
    ]);
    const input = await parseJsonBody(request, agencyIdSchema);
    const user = await switchSessionAgency(input.agencyId);
    return noStoreJson({ user: toClientSessionUser(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

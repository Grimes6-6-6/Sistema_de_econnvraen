import { requireApiRole } from "@/lib/auth/authorization";
import { switchSessionAgency } from "@/lib/auth/session";
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
    return noStoreJson({ user: await switchSessionAgency(input.agencyId) });
  } catch (error) {
    return handleRouteError(error);
  }
}

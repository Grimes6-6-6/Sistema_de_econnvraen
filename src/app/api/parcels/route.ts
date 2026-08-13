import { requireApiRole } from "@/lib/auth/authorization";
import { parcelInputSchema } from "@/lib/validation/schemas";
import { createParcel } from "@/server/data/operations";
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
    const input = await parseJsonBody(request, parcelInputSchema);
    const item = await createParcel(user, input);
    return noStoreJson({ item }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

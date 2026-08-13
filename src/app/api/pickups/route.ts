import { requireApiRole } from "@/lib/auth/authorization";
import { pickupInputSchema } from "@/lib/validation/schemas";
import { createPickup } from "@/server/data/operations";
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
    const input = await parseJsonBody(request, pickupInputSchema);
    const item = await createPickup(user, input);
    return noStoreJson({ item }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { requireApiRole } from "@/lib/auth/authorization";
import { driverProfileUpdateSchema } from "@/lib/validation/schemas";
import { updateDriverContact } from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiRole(["CONDUCTOR", "ADMINISTRADOR"]);
    const input = await parseJsonBody(request, driverProfileUpdateSchema);
    const contact = await updateDriverContact(user, input);
    return noStoreJson({ success: true, contact });
  } catch (error) {
    return handleRouteError(error);
  }
}

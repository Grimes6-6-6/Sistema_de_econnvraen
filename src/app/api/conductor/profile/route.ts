import { requireApiRole } from "@/lib/auth/authorization";
import { driverProfileUpdateSchema } from "@/lib/validation/schemas";
import { getDriverContact, updateDriverContact } from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiRole(["CONDUCTOR"]);
    const contact = await getDriverContact(user);
    return noStoreJson({ contact });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiRole(["CONDUCTOR"]);
    const input = await parseJsonBody(request, driverProfileUpdateSchema);
    const contact = await updateDriverContact(user, input);
    return noStoreJson({ success: true, contact });
  } catch (error) {
    return handleRouteError(error);
  }
}

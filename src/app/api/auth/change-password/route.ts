import { getSessionUser, deleteSession } from "@/lib/auth/session";
import { changePasswordSchema } from "@/lib/validation/schemas";
import { changeOwnPassword } from "@/server/admin/users";
import { unauthorized } from "@/server/errors";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await getSessionUser();
    if (!user) throw unauthorized();
    const input = await parseJsonBody(request, changePasswordSchema);
    await changeOwnPassword(user, input);
    await deleteSession();
    return noStoreJson({ success: true, reauthenticate: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

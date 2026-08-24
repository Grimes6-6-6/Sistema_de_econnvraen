import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { adminUserUpdateSchema } from "@/lib/validation/schemas";
import { updateManagedUser } from "@/server/admin/users";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.USER_MANAGE);
    const input = await parseJsonBody(request, adminUserUpdateSchema);
    const { id } = await params;
    return noStoreJson({ user: await updateManagedUser(user, id, input) });
  } catch (error) {
    return handleRouteError(error);
  }
}

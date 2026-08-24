import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { resetManagedUserPassword } from "@/server/admin/users";
import { assertTrustedMutation, handleRouteError, noStoreJson } from "@/server/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.USER_MANAGE);
    const { id } = await params;
    return noStoreJson(await resetManagedUserPassword(user, id));
  } catch (error) {
    return handleRouteError(error);
  }
}

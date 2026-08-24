import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { adminUserCreateSchema } from "@/lib/validation/schemas";
import { createManagedUser, listManagedUsers } from "@/server/admin/users";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.USER_MANAGE);
    return noStoreJson({ users: await listManagedUsers(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.USER_MANAGE);
    const input = await parseJsonBody(request, adminUserCreateSchema);
    const created = await createManagedUser(user, input);
    return noStoreJson(created, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

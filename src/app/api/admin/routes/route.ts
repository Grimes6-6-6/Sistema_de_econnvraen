import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { managedRouteSchema } from "@/lib/validation/schemas";
import { createManagedRoute, listManagedRoutes } from "@/server/admin/catalog";
import { assertTrustedMutation, handleRouteError, noStoreJson, parseJsonBody } from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    return noStoreJson({ routes: await listManagedRoutes(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    const input = await parseJsonBody(request, managedRouteSchema);
    return noStoreJson({ route: await createManagedRoute(user, input) }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { managedRouteUpdateSchema } from "@/lib/validation/schemas";
import { updateManagedRoute } from "@/server/admin/catalog";
import { assertTrustedMutation, handleRouteError, noStoreJson, parseJsonBody } from "@/server/http";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    const input = await parseJsonBody(request, managedRouteUpdateSchema);
    const { id } = await params;
    return noStoreJson({ route: await updateManagedRoute(user, id, input) });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { managedVehicleUpdateSchema } from "@/lib/validation/schemas";
import { updateManagedVehicle } from "@/server/admin/catalog";
import { assertTrustedMutation, handleRouteError, noStoreJson, parseJsonBody } from "@/server/http";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    const input = await parseJsonBody(request, managedVehicleUpdateSchema);
    const { id } = await params;
    return noStoreJson({ vehicle: await updateManagedVehicle(user, id, input) });
  } catch (error) {
    return handleRouteError(error);
  }
}

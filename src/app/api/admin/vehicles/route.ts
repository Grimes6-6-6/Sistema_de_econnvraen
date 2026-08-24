import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { managedVehicleSchema } from "@/lib/validation/schemas";
import { createManagedVehicle, listManagedVehicles } from "@/server/admin/catalog";
import { assertTrustedMutation, handleRouteError, noStoreJson, parseJsonBody } from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    return noStoreJson({ vehicles: await listManagedVehicles(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    const input = await parseJsonBody(request, managedVehicleSchema);
    return noStoreJson({ vehicle: await createManagedVehicle(user, input) }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

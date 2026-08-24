import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { listRouteDestinations } from "@/server/admin/catalog";
import { handleRouteError, noStoreJson } from "@/server/http";

export async function GET() {
  try {
    await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    return noStoreJson({ agencies: await listRouteDestinations() });
  } catch (error) {
    return handleRouteError(error);
  }
}

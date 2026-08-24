import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { listAllAgencies } from "@/server/agencies";
import { handleRouteError, noStoreJson } from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.AGENCY_MANAGE);
    return noStoreJson({ agencies: await listAllAgencies(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

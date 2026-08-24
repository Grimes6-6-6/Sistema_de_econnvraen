import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { handleRouteError, noStoreJson } from "@/server/http";
import { getDatabaseSnapshot } from "@/server/data/operations";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.DATA_VIEW);
    const data = await getDatabaseSnapshot(user);
    return noStoreJson({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

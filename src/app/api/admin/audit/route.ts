import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { listAuditEntries } from "@/server/admin/audit";
import { handleRouteError, noStoreJson } from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.AUDIT_VIEW);
    return noStoreJson({ entries: await listAuditEntries(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import {
  backupsAreConfigured,
  createBackup,
  listBackups,
} from "@/server/admin/backups";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
} from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    await requireApiPermission(PERMISSIONS.BACKUP_MANAGE);
    return noStoreJson({
      configured: backupsAreConfigured(),
      backups: await listBackups(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.BACKUP_MANAGE);
    const backup = await createBackup(user);
    return new Response(new Uint8Array(backup.archive), {
      status: 201,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${backup.filename}"`,
        "Content-Length": String(backup.archive.byteLength),
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Backup-Sha256": backup.entry.sha256,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { z } from "zod";
import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listNotifications, markNotificationRead } from "@/server/notifications";
import { assertTrustedMutation, handleRouteError, noStoreJson, parseJsonBody } from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.DATA_VIEW);
    return noStoreJson(await listNotifications(user));
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.DATA_VIEW);
    const { id } = await parseJsonBody(request, z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict());
    await markNotificationRead(user, id);
    return noStoreJson({ ok: true });
  } catch (error) { return handleRouteError(error); }
}

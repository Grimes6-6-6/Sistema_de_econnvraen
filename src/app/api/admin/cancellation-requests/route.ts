import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { listTicketCancellationRequests } from "@/server/admin/cancellations";
import { handleRouteError, noStoreJson } from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.TICKET_CANCEL_APPROVE);
    return noStoreJson({ requests: await listTicketCancellationRequests(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

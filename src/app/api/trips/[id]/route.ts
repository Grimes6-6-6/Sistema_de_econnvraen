import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTripDetail } from "@/server/data/operations";
import { handleRouteError, noStoreJson } from "@/server/http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiPermission(PERMISSIONS.TRIP_VIEW);
    const { id } = await params;
    const data = await getTripDetail(user, id);
    return noStoreJson(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

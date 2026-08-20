import { requireApiRole } from "@/lib/auth/authorization";
import { getTripDetail } from "@/server/data/operations";
import { handleRouteError, noStoreJson } from "@/server/http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiRole(["CONDUCTOR", "ADMINISTRADOR", "OPERADOR"]);
    const { id } = await params;
    const data = await getTripDetail(user, id);
    return noStoreJson(data);
  } catch (error) {
    return handleRouteError(error);
  }
}

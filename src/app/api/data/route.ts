import { requireApiRole } from "@/lib/auth/authorization";
import { handleRouteError, noStoreJson } from "@/server/http";
import { getDatabaseSnapshot } from "@/server/data/operations";

export async function GET() {
  try {
    const user = await requireApiRole(["OPERADOR", "CONDUCTOR", "ADMINISTRADOR"]);
    const data = await getDatabaseSnapshot(user);
    return noStoreJson({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { getSessionUser } from "@/lib/auth/session";
import { toClientSessionUser } from "@/lib/auth/types";
import { handleRouteError, noStoreJson } from "@/server/http";

export async function GET() {
  try {
    const user = await getSessionUser();
    return user
      ? noStoreJson({ user: toClientSessionUser(user) })
      : noStoreJson({ user: null }, { status: 401 });
  } catch (error) {
    return handleRouteError(error);
  }
}

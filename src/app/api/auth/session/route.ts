import { getSessionUser } from "@/lib/auth/session";
import { handleRouteError, noStoreJson } from "@/server/http";

export async function GET() {
  try {
    const user = await getSessionUser();
    return user
      ? noStoreJson({ user })
      : noStoreJson({ user: null }, { status: 401 });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { deleteSession } from "@/lib/auth/session";
import {
  assertTrustedMutation,
  handleRouteError,
} from "@/server/http";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    await deleteSession();
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { requireApiRole } from "@/lib/auth/authorization";
import { driverIdentityReviewSchema } from "@/lib/validation/schemas";
import { reviewDriverIdentity } from "@/server/admin/users";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const actor = await requireApiRole(["SUPER_ADMIN"]);
    const input = await parseJsonBody(request, driverIdentityReviewSchema);
    const { id } = await params;
    return noStoreJson({
      user: await reviewDriverIdentity(actor, id, input),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

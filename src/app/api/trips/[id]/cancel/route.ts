import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { cancelTrip } from "@/server/data/operations";
import { cancellationSchema } from "@/lib/validation/schemas";
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
    const user = await requireApiPermission(PERMISSIONS.TRIP_MANAGE);
    const { id } = await params;
    const input = await parseJsonBody(request, cancellationSchema);
    await cancelTrip(user, id, input);
    return noStoreJson({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

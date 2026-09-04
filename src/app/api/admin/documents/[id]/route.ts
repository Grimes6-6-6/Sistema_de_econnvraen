import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { operationalDocumentReviewSchema } from "@/lib/validation/schemas";
import { reviewOperationalDocument } from "@/server/admin/documents";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    const input = await parseJsonBody(request, operationalDocumentReviewSchema);
    const { id } = await params;
    return noStoreJson({
      document: await reviewOperationalDocument(user, id, input),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

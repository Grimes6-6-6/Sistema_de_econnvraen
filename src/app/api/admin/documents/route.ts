import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { operationalDocumentSchema } from "@/lib/validation/schemas";
import {
  createOperationalDocument,
  listOperationalDocuments,
} from "@/server/admin/documents";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    return noStoreJson({ documents: await listOperationalDocuments(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.FLEET_MANAGE);
    const input = await parseJsonBody(request, operationalDocumentSchema);
    return noStoreJson(
      { document: await createOperationalDocument(user, input) },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

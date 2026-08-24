import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { agencyInputSchema } from "@/lib/validation/schemas";
import { createAgency, listAgencies } from "@/server/agencies";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.AGENCY_SWITCH);
    return noStoreJson({ agencies: await listAgencies(user) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.AGENCY_MANAGE);
    const input = await parseJsonBody(request, agencyInputSchema);
    return noStoreJson(
      { agency: await createAgency(user, input) },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

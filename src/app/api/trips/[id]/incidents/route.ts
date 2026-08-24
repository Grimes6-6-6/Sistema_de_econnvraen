import { requireApiPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { tripIncidentSchema } from "@/lib/validation/schemas";
import {
  createTripIncident,
  getTripIncidents,
} from "@/server/data/operations";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiPermission(PERMISSIONS.INCIDENT_VIEW);
    const { id } = await params;
    const incidents = await getTripIncidents(user, id);
    return noStoreJson({ incidents });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.INCIDENT_CREATE);
    const { id } = await params;
    const input = await parseJsonBody(request, tripIncidentSchema);
    const incident = await createTripIncident(user, id, input);
    return noStoreJson({ incident }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

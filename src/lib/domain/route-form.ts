import type { UserRole } from "@/lib/auth/types";

interface RouteFormAgency {
  id: string;
}

interface RouteFormSelection {
  role: UserRole;
  activeAgencyId: string | null;
  originAgencyId: string;
  destinationAgencyId: string;
}

export function getRouteFormAgencyOptions<T extends RouteFormAgency>(
  agencies: T[],
  selection: RouteFormSelection,
) {
  const origins = selection.role === "SUPER_ADMIN"
    ? agencies
    : agencies.filter((agency) => agency.id === selection.activeAgencyId);
  const originAgencyId = origins.some((agency) => agency.id === selection.originAgencyId)
    ? selection.originAgencyId
    : origins.find((agency) => agency.id === selection.activeAgencyId)?.id || origins[0]?.id || "";
  const destinations = originAgencyId
    ? agencies.filter((agency) => agency.id !== originAgencyId)
    : [];
  const destinationAgencyId = destinations.some((agency) => agency.id === selection.destinationAgencyId)
    ? selection.destinationAgencyId
    : "";

  return { origins, destinations, originAgencyId, destinationAgencyId };
}

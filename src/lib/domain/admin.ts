import type { UserRole } from "@/lib/auth/types";

export interface ManagedUser {
  id: string;
  username: string;
  names: string;
  surnames: string;
  dni: string;
  phone: string;
  email: string;
  role: UserRole;
  state: "ACTIVO" | "INACTIVO" | "BLOQUEADO";
  agencyIds: string[];
  agencyNames: string[];
  mustChangePassword: boolean;
  smsMfaEnabled: boolean;
  lastLoginAt: string | null;
  driver: {
    id: string;
    licenseNumber: string;
    licenseCategory: string;
    licenseExpiresAt: string;
    enabled: boolean;
    identityState: "PENDIENTE" | "VERIFICADA" | "OBSERVADA";
    identityObservation: string;
    identityReviewedAt: string | null;
  } | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  username: string;
  agencyName: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface TicketCancellationRequest {
  id: string;
  ticketId: string;
  ticketCode: string;
  passengerName: string;
  requestedBy: string;
  requestReason: string;
  state: "PENDIENTE" | "APROBADA" | "RECHAZADA";
  resolvedBy: string;
  resolutionReason: string;
  requestedAt: string;
  resolvedAt: string | null;
}

export interface OperationalDocument {
  id: string;
  holderType: "CONDUCTOR" | "VEHICULO";
  holderId: string;
  holderName: string;
  documentType:
    | "DNI"
    | "LICENCIA"
    | "SOAT"
    | "CITV"
    | "TUC"
    | "TARJETA_PROPIEDAD"
    | "ANTECEDENTES"
    | "SALUD"
    | "OTRO";
  number: string;
  issuedAt: string;
  expiresAt: string;
  state: "PENDIENTE" | "VIGENTE" | "POR_VENCER" | "VENCIDO" | "OBSERVADO";
  notes: string;
  source: "ADMIN" | "CONDUCTOR";
  file: {
    name: string;
    mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
    size: number;
    downloadUrl: string;
  } | null;
}

export const PERSONAL_DOCUMENT_TYPES = [
  "DNI",
  "LICENCIA",
  "ANTECEDENTES",
  "SALUD",
  "OTRO",
] as const satisfies readonly OperationalDocument["documentType"][];

export const VEHICLE_DOCUMENT_TYPES = [
  "SOAT",
  "CITV",
  "TUC",
  "TARJETA_PROPIEDAD",
] as const satisfies readonly OperationalDocument["documentType"][];

export function isVehicleDocumentType(
  value: OperationalDocument["documentType"],
): boolean {
  return VEHICLE_DOCUMENT_TYPES.includes(
    value as (typeof VEHICLE_DOCUMENT_TYPES)[number],
  );
}

export interface ManagedRoute {
  id: string;
  originAgencyId: string;
  destinationAgencyId: string;
  origin: string;
  destination: string;
  distanceKm: number;
  durationHours: number;
  price: number;
  state: "ACTIVO" | "INACTIVO";
}

export interface ManagedVehicle {
  id: string;
  agencyId: string;
  plate: string;
  type: string;
  brand: string;
  model: string;
  capacity: number;
  year: number | null;
  state: "ACTIVO" | "MANTENIMIENTO" | "DE_BAJA";
}

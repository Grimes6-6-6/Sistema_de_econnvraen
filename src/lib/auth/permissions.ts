import type { UserRole } from "./types";

export const PERMISSIONS = {
  DATA_VIEW: "data:view",
  AGENCY_SWITCH: "agency:switch",
  AGENCY_MANAGE: "agency:manage",
  USER_MANAGE: "user:manage",
  USER_MANAGE_SUPER: "user:manage-super",
  AUDIT_VIEW: "audit:view",
  REPORTS_AGENCY: "reports:agency",
  REPORTS_GLOBAL: "reports:global",
  CASH_TODAY_VIEW: "cash:today-view",
  TICKET_SELL: "ticket:sell",
  TICKET_CANCEL_REQUEST: "ticket:cancel-request",
  TICKET_CANCEL_APPROVE: "ticket:cancel-approve",
  DNI_LOOKUP: "dni:lookup",
  PARCEL_CREATE: "parcel:create",
  PARCEL_STATUS_MANAGE: "parcel:status-manage",
  TRIP_VIEW: "trip:view",
  TRIP_MANAGE: "trip:manage",
  TRIP_STATUS_MANAGE: "trip:status-manage",
  PICKUP_CREATE: "pickup:create",
  PICKUP_ASSIGN: "pickup:assign",
  PICKUP_STATUS_MANAGE: "pickup:status-manage",
  FLEET_VIEW: "fleet:view",
  FLEET_MANAGE: "fleet:manage",
  INCIDENT_VIEW: "incident:view",
  INCIDENT_CREATE: "incident:create",
  DRIVER_SELF_MANAGE: "driver:self-manage",
  GPS_PUBLISH: "gps:publish",
  CONFIG_MANAGE: "config:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ADMINISTRADOR: [
    PERMISSIONS.DATA_VIEW,
    PERMISSIONS.AGENCY_SWITCH,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.REPORTS_AGENCY,
    PERMISSIONS.CASH_TODAY_VIEW,
    PERMISSIONS.TICKET_SELL,
    PERMISSIONS.TICKET_CANCEL_REQUEST,
    PERMISSIONS.TICKET_CANCEL_APPROVE,
    PERMISSIONS.DNI_LOOKUP,
    PERMISSIONS.PARCEL_CREATE,
    PERMISSIONS.PARCEL_STATUS_MANAGE,
    PERMISSIONS.TRIP_VIEW,
    PERMISSIONS.TRIP_MANAGE,
    PERMISSIONS.TRIP_STATUS_MANAGE,
    PERMISSIONS.PICKUP_CREATE,
    PERMISSIONS.PICKUP_ASSIGN,
    PERMISSIONS.PICKUP_STATUS_MANAGE,
    PERMISSIONS.FLEET_VIEW,
    PERMISSIONS.FLEET_MANAGE,
    PERMISSIONS.INCIDENT_VIEW,
    PERMISSIONS.INCIDENT_CREATE,
  ],
  OPERADOR: [
    PERMISSIONS.DATA_VIEW,
    PERMISSIONS.AGENCY_SWITCH,
    PERMISSIONS.CASH_TODAY_VIEW,
    PERMISSIONS.TICKET_SELL,
    PERMISSIONS.TICKET_CANCEL_REQUEST,
    PERMISSIONS.DNI_LOOKUP,
    PERMISSIONS.PARCEL_CREATE,
    PERMISSIONS.TRIP_VIEW,
    PERMISSIONS.PICKUP_CREATE,
    PERMISSIONS.INCIDENT_VIEW,
  ],
  CONDUCTOR: [
    PERMISSIONS.DATA_VIEW,
    PERMISSIONS.AGENCY_SWITCH,
    PERMISSIONS.PARCEL_STATUS_MANAGE,
    PERMISSIONS.TRIP_VIEW,
    PERMISSIONS.TRIP_STATUS_MANAGE,
    PERMISSIONS.PICKUP_STATUS_MANAGE,
    PERMISSIONS.INCIDENT_VIEW,
    PERMISSIONS.INCIDENT_CREATE,
    PERMISSIONS.DRIVER_SELF_MANAGE,
    PERMISSIONS.GPS_PUBLISH,
  ],
};

export function roleHasPermission(
  role: UserRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function roleHasEveryPermission(
  role: UserRole,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => roleHasPermission(role, permission));
}

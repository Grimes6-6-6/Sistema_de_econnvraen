import type { UserRole } from "./types";
import rolePermissionConfig from "./role-permissions.json";

export const PERMISSIONS = {
  DATA_VIEW: "data:view",
  AGENCY_SWITCH: "agency:switch",
  AGENCY_MANAGE: "agency:manage",
  USER_MANAGE: "user:manage",
  USER_MANAGE_SUPER: "user:manage-super",
  AUDIT_VIEW: "audit:view",
  BACKUP_MANAGE: "backup:manage",
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

const permissionValues = new Set<string>(ALL_PERMISSIONS);
const roleNames: UserRole[] = [
  "SUPER_ADMIN",
  "ADMINISTRADOR",
  "OPERADOR",
  "CONDUCTOR",
];

for (const role of roleNames) {
  const permissions = rolePermissionConfig[role];
  if (!Array.isArray(permissions) || permissions.some((permission) => !permissionValues.has(permission))) {
    throw new Error(`PERMISSION_CONFIG_INVALID_${role}`);
  }
}

const ROLE_PERMISSIONS = rolePermissionConfig as Readonly<Record<UserRole, readonly Permission[]>>;

export function roleHasPermission(
  role: UserRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

import { describe, expect, it } from "vitest";
import { PERMISSIONS, roleHasPermission } from "@/lib/auth/permissions";

describe("matriz empresarial de permisos", () => {
  it("reserva la gestión global al superadministrador", () => {
    expect(roleHasPermission("SUPER_ADMIN", PERMISSIONS.AGENCY_MANAGE)).toBe(true);
    expect(roleHasPermission("SUPER_ADMIN", PERMISSIONS.REPORTS_GLOBAL)).toBe(true);
    expect(roleHasPermission("ADMINISTRADOR", PERMISSIONS.AGENCY_MANAGE)).toBe(false);
  });

  it("limita al operador a tareas transaccionales", () => {
    expect(roleHasPermission("OPERADOR", PERMISSIONS.TICKET_SELL)).toBe(true);
    expect(roleHasPermission("OPERADOR", PERMISSIONS.DNI_LOOKUP)).toBe(true);
    expect(roleHasPermission("OPERADOR", PERMISSIONS.PARCEL_CREATE)).toBe(true);
    expect(roleHasPermission("OPERADOR", PERMISSIONS.TICKET_CANCEL_APPROVE)).toBe(false);
    expect(roleHasPermission("OPERADOR", PERMISSIONS.TRIP_MANAGE)).toBe(false);
    expect(roleHasPermission("OPERADOR", PERMISSIONS.REPORTS_AGENCY)).toBe(false);
    expect(roleHasPermission("OPERADOR", PERMISSIONS.FLEET_VIEW)).toBe(false);
  });

  it("mantiene al conductor en su operación propia", () => {
    expect(roleHasPermission("CONDUCTOR", PERMISSIONS.GPS_PUBLISH)).toBe(true);
    expect(roleHasPermission("CONDUCTOR", PERMISSIONS.TRIP_STATUS_MANAGE)).toBe(true);
    expect(roleHasPermission("CONDUCTOR", PERMISSIONS.TICKET_SELL)).toBe(false);
    expect(roleHasPermission("CONDUCTOR", PERMISSIONS.USER_MANAGE)).toBe(false);
  });
});

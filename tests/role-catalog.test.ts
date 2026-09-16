import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, roleHasPermission } from "@/lib/auth/permissions";
import rolePermissionConfig from "@/lib/auth/role-permissions.json";
import type { UserRole } from "@/lib/auth/types";

const migration = readFileSync(
  new URL("../db/migrations/018_canonical_role_permissions.sql", import.meta.url),
  "utf8",
);
const roles: UserRole[] = ["SUPER_ADMIN", "ADMINISTRADOR", "OPERADOR", "CONDUCTOR"];
const descriptions = {
  SUPER_ADMIN: "Administración global de todas las agencias",
  ADMINISTRADOR: "Administración de sus agencias asignadas",
  OPERADOR: "Ventas, encomiendas, viajes y recojos",
  CONDUCTOR: "Manifiestos y entregas de sus viajes",
};
const globalPermissions = [
  PERMISSIONS.AGENCY_MANAGE,
  PERMISSIONS.USER_MANAGE_SUPER,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.BACKUP_MANAGE,
  PERMISSIONS.REPORTS_GLOBAL,
  PERMISSIONS.CONFIG_MANAGE,
];

function migrationRoles() {
  return [...migration.matchAll(
    /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'(\[[^']*\])'::jsonb\s*\)/g,
  )].map(([, name, description, permissions]) => ({
    name,
    description,
    permissions: JSON.parse(permissions) as string[],
  }));
}

describe("catálogo canónico de roles", () => {
  it("concede al superadministrador todos los permisos definidos", () => {
    expect(rolePermissionConfig.SUPER_ADMIN).toEqual(Object.values(PERMISSIONS));
    for (const permission of Object.values(PERMISSIONS)) {
      expect(roleHasPermission("SUPER_ADMIN", permission)).toBe(true);
    }
  });

  it.each(["ADMINISTRADOR", "OPERADOR", "CONDUCTOR"] as const)(
    "%s no recibe privilegios globales",
    (role) => {
      for (const permission of globalPermissions) {
        expect(roleHasPermission(role, permission)).toBe(false);
      }
      expect(rolePermissionConfig[role].every(
        (permission) => rolePermissionConfig.SUPER_ADMIN.includes(permission),
      )).toBe(true);
    },
  );

  it("mantiene al operador subordinado a los permisos del administrador", () => {
    expect(rolePermissionConfig.OPERADOR.every(
      (permission) => rolePermissionConfig.ADMINISTRADOR.includes(permission),
    )).toBe(true);
  });

  it("contiene exactamente cuatro roles sin permisos desconocidos o duplicados", () => {
    expect(Object.keys(rolePermissionConfig)).toEqual(roles);
    for (const role of roles) {
      const permissions = rolePermissionConfig[role];
      expect(new Set(permissions).size).toBe(permissions.length);
      expect(permissions.every(
        (permission) => (Object.values(PERMISSIONS) as string[]).includes(permission),
      )).toBe(true);
    }
  });

  it("persiste la misma matriz exacta, incluidas las descripciones y el orden", () => {
    expect(migrationRoles()).toEqual(roles.map((role) => ({
      name: role,
      description: descriptions[role],
      permissions: rolePermissionConfig[role],
    })));
  });

  it("crea los cuatro roles durante el bootstrap y actualiza el catálogo existente sin tocar usuarios", () => {
    expect(migration).toMatch(/INSERT INTO roles\s*\(nombre, descripcion, permisos\)\s*VALUES/);
    expect(migrationRoles().map((row) => row.name)).toEqual(roles);
    expect(migration).toMatch(/ON CONFLICT\s*\(nombre\)\s*DO UPDATE\s*SET descripcion = EXCLUDED\.descripcion,\s*permisos = EXCLUDED\.permisos;/);
    expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE)\s+usuarios\b/i);
    expect(migration).not.toMatch(/\b(?:id_usuario|username|password_hash)\b/i);
  });
});

import "server-only";

import bcrypt from "bcryptjs";
import type { SessionUser, UserRole } from "./types";
import { query } from "@/server/db/pool";

const DUMMY_PASSWORD_HASH =
  "$2b$12$asEJ6yUkaf8qurzRbqalFuaaAUf8LqqbRqdhJVRtYW57XZv0c/0J.";

interface UserRow {
  id_usuario: number;
  username: string;
  password_hash: string;
  rol: UserRole;
  nombres: string | null;
  apellidos: string | null;
  dni: string | null;
  telefono: string | null;
  id_conductor: number | null;
  id_agencia: number | null;
  agencia_nombre: string | null;
  must_change_password: boolean;
  mfa_enabled?: boolean;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: `U${String(row.id_usuario).padStart(3, "0")}`,
    username: row.username,
    nombres: row.nombres || "Usuario",
    apellidos: row.apellidos || "",
    rol: row.rol,
    dni: row.dni || "",
    conductorId:
      row.id_conductor === null
        ? null
        : `C${String(row.id_conductor).padStart(2, "0")}`,
    agenciaId:
      row.id_agencia === null
        ? null
        : `A${String(row.id_agencia).padStart(3, "0")}`,
    agenciaNombre: row.agencia_nombre,
    mustChangePassword: row.must_change_password,
  };
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<{ user: SessionUser; mfaEnabled: boolean; phone: string | null } | null> {
  const result = await query<UserRow>(
    `SELECT
       u.id_usuario,
       u.username,
       u.password_hash,
       r.nombre AS rol,
       p.nombres,
       p.apellidos,
       p.nro_documento AS dni,
       p.telefono,
       driver.id_conductor,
       membership.id_agencia,
       agency.nombre AS agencia_nombre
       , u.must_change_password
       , u.mfa_enabled
     FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     LEFT JOIN personas p ON p.id_persona = u.id_persona
     LEFT JOIN conductores driver ON driver.id_persona = u.id_persona
     LEFT JOIN LATERAL (
       SELECT ua.id_agencia
       FROM usuarios_agencias ua
       JOIN agencias active_agency
         ON active_agency.id_agencia = ua.id_agencia
        AND active_agency.estado = 'ACTIVA'
       WHERE ua.id_usuario = u.id_usuario
         AND ua.estado = 'ACTIVO'
       ORDER BY ua.es_principal DESC, ua.id_agencia
       LIMIT 1
     ) membership ON TRUE
     LEFT JOIN agencias agency ON agency.id_agencia = membership.id_agencia
     WHERE LOWER(u.username) = LOWER($1)
       AND u.estado = 'ACTIVO'
       AND (
         u.must_change_password = FALSE
         OR u.temporary_password_expires_at > NOW()
       )
       AND (r.nombre = 'SUPER_ADMIN' OR membership.id_agencia IS NOT NULL)
     LIMIT 1`,
    [username],
  );

  const row = result.rows[0];
  const matches = await bcrypt.compare(
    password,
    row?.password_hash || DUMMY_PASSWORD_HASH,
  );

  if (!row || !matches) return null;

  return {
    user: toSessionUser(row),
    mfaEnabled: Boolean(row.mfa_enabled),
    phone: row.telefono,
  };
}

export async function findUserById(userId: number): Promise<SessionUser | null> {
  const result = await query<UserRow>(
    `SELECT
       u.id_usuario,
       u.username,
       u.password_hash,
       r.nombre AS rol,
       p.nombres,
       p.apellidos,
       p.nro_documento AS dni,
       p.telefono,
       driver.id_conductor,
       membership.id_agencia,
       agency.nombre AS agencia_nombre
       , u.must_change_password
     FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     LEFT JOIN personas p ON p.id_persona = u.id_persona
     LEFT JOIN conductores driver ON driver.id_persona = u.id_persona
     LEFT JOIN LATERAL (
       SELECT ua.id_agencia
       FROM usuarios_agencias ua
       JOIN agencias active_agency
         ON active_agency.id_agencia = ua.id_agencia
        AND active_agency.estado = 'ACTIVA'
       WHERE ua.id_usuario = u.id_usuario
         AND ua.estado = 'ACTIVO'
       ORDER BY ua.es_principal DESC, ua.id_agencia
       LIMIT 1
     ) membership ON TRUE
     LEFT JOIN agencias agency ON agency.id_agencia = membership.id_agencia
     WHERE u.id_usuario = $1
       AND u.estado = 'ACTIVO'
       AND (
         u.must_change_password = FALSE
         OR u.temporary_password_expires_at > NOW()
       )
       AND (r.nombre = 'SUPER_ADMIN' OR membership.id_agencia IS NOT NULL)
     LIMIT 1`,
    [userId],
  );

  return result.rows[0] ? toSessionUser(result.rows[0]) : null;
}

export function roleCanAccess(
  role: UserRole,
  allowedRoles: readonly UserRole[],
): boolean {
  return role === "SUPER_ADMIN" || allowedRoles.includes(role);
}

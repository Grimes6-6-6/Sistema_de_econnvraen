import "server-only";

import bcrypt from "bcryptjs";
import type { QueryResultRow } from "pg";
import type { SessionUser, UserRole } from "@/lib/auth/types";
import type { ManagedUser } from "@/lib/domain/admin";
import { formatEntityId, parseEntityId } from "@/lib/domain/ids";
import type {
  AdminUserCreateInput,
  AdminUserUpdateInput,
  ChangePasswordInput,
} from "@/lib/validation/schemas";
import { createTemporaryPassword } from "@/server/auth/passwords";
import { writeAuditLog } from "@/server/audit";
import { query, withTransaction } from "@/server/db/pool";
import { conflict, forbidden, notFound, unauthorized } from "@/server/errors";

const PASSWORD_COST = 12;
const TEMPORARY_PASSWORD_HOURS = 24;

interface ManagedUserRow extends QueryResultRow {
  id_usuario: number;
  username: string;
  nombres: string;
  apellidos: string;
  dni: string;
  telefono: string;
  email: string;
  rol: UserRole;
  estado: ManagedUser["state"];
  agency_ids: number[] | null;
  agency_names: string[] | null;
  must_change_password: boolean;
  mfa_enabled: boolean;
  last_login_at: string | null;
  id_conductor: number | null;
  nro_licencia: string | null;
  categoria_licencia: string | null;
  fecha_vencimiento: string | null;
  conductor_habilitado: boolean | null;
}

interface TargetUserRow extends QueryResultRow {
  id_usuario: number;
  id_persona: number;
  role: UserRole;
  agency_ids: number[];
}

function actorId(user: SessionUser): number {
  const id = parseEntityId(user.id, "U");
  if (!id) throw forbidden("La sesión no tiene un usuario válido.");
  return id;
}

function actorAgencyId(user: SessionUser): number {
  const id = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  if (!id) throw forbidden("Selecciona una agencia activa.");
  return id;
}

function mapUser(row: ManagedUserRow): ManagedUser {
  return {
    id: formatEntityId("U", row.id_usuario),
    username: row.username,
    names: row.nombres,
    surnames: row.apellidos,
    dni: row.dni,
    phone: row.telefono || "",
    email: row.email || "",
    role: row.rol,
    state: row.estado,
    agencyIds: (row.agency_ids || []).map((id) => formatEntityId("A", id)),
    agencyNames: row.agency_names || [],
    mustChangePassword: row.must_change_password,
    mfaEnabled: row.mfa_enabled,
    lastLoginAt: row.last_login_at,
    driver:
      row.id_conductor && row.nro_licencia && row.categoria_licencia && row.fecha_vencimiento
        ? {
            id: formatEntityId("C", row.id_conductor, 2),
            licenseNumber: row.nro_licencia,
            licenseCategory: row.categoria_licencia,
            licenseExpiresAt: row.fecha_vencimiento,
            enabled: Boolean(row.conductor_habilitado),
          }
        : null,
  };
}

const USER_SELECT = `
  SELECT
    u.id_usuario,
    u.username,
    COALESCE(p.nombres, '') AS nombres,
    COALESCE(p.apellidos, '') AS apellidos,
    COALESCE(p.nro_documento, '') AS dni,
    COALESCE(p.telefono, '') AS telefono,
    COALESCE(p.email, '') AS email,
    r.nombre AS rol,
    u.estado,
    COALESCE(
      ARRAY_AGG(ua.id_agencia ORDER BY ua.es_principal DESC, ua.id_agencia)
        FILTER (WHERE ua.estado = 'ACTIVO'),
      ARRAY[]::integer[]
    ) AS agency_ids,
    COALESCE(
      ARRAY_AGG(a.nombre ORDER BY ua.es_principal DESC, ua.id_agencia)
        FILTER (WHERE ua.estado = 'ACTIVO'),
      ARRAY[]::varchar[]
    ) AS agency_names,
    u.must_change_password,
    u.mfa_enabled,
    u.last_login_at::text,
    c.id_conductor,
    c.nro_licencia,
    c.categoria_licencia,
    c.fecha_vencimiento::text,
    c.habilitado AS conductor_habilitado
  FROM usuarios u
  JOIN roles r ON r.id_rol = u.id_rol
  LEFT JOIN personas p ON p.id_persona = u.id_persona
  LEFT JOIN usuarios_agencias ua ON ua.id_usuario = u.id_usuario
  LEFT JOIN agencias a ON a.id_agencia = ua.id_agencia
  LEFT JOIN conductores c ON c.id_persona = u.id_persona
`;

export async function listManagedUsers(user: SessionUser): Promise<ManagedUser[]> {
  const agencyId = user.rol === "SUPER_ADMIN" ? null : actorAgencyId(user);
  const result = await query<ManagedUserRow>(
    `${USER_SELECT}
     WHERE (
       $1::integer IS NULL
       OR EXISTS (
         SELECT 1 FROM usuarios_agencias scope
         WHERE scope.id_usuario = u.id_usuario
           AND scope.id_agencia = $1
           AND scope.estado = 'ACTIVO'
       )
     )
       AND ($1::integer IS NULL OR r.nombre IN ('OPERADOR', 'CONDUCTOR'))
     GROUP BY u.id_usuario, p.id_persona, r.nombre, c.id_conductor
     ORDER BY r.nombre, p.apellidos, p.nombres`,
    [agencyId],
  );
  return result.rows.map(mapUser);
}

async function resolveAgencyIds(
  user: SessionUser,
  values: string[],
): Promise<number[]> {
  const ids = [...new Set(values.map((value) => parseEntityId(value, "A")))];
  if (ids.some((id) => !id)) throw forbidden("Una agencia no es válida.");
  const numericIds = ids as number[];
  if (user.rol !== "SUPER_ADMIN") {
    const allowed = actorAgencyId(user);
    if (numericIds.length !== 1 || numericIds[0] !== allowed) {
      throw forbidden("Solo puedes asignar usuarios a tu agencia activa.");
    }
  }
  const existing = await query<{ id_agencia: number }>(
    `SELECT id_agencia FROM agencias
     WHERE id_agencia = ANY($1::integer[]) AND estado = 'ACTIVA'`,
    [numericIds],
  );
  if (existing.rowCount !== numericIds.length) {
    throw conflict("AGENCY_NOT_AVAILABLE", "Una agencia no está activa.");
  }
  return numericIds;
}

function assertAssignableRole(actor: SessionUser, role: UserRole): void {
  if (actor.rol === "SUPER_ADMIN") return;
  if (!(["OPERADOR", "CONDUCTOR"] as UserRole[]).includes(role)) {
    throw forbidden("Un administrador solo puede gestionar operadores y conductores.");
  }
}

async function findTarget(userId: number): Promise<TargetUserRow> {
  const result = await query<TargetUserRow>(
    `SELECT u.id_usuario, u.id_persona, r.nombre AS role,
            COALESCE(ARRAY_AGG(ua.id_agencia) FILTER (WHERE ua.estado = 'ACTIVO'), ARRAY[]::integer[]) AS agency_ids
     FROM usuarios u
     JOIN roles r ON r.id_rol = u.id_rol
     LEFT JOIN usuarios_agencias ua ON ua.id_usuario = u.id_usuario
     WHERE u.id_usuario = $1
     GROUP BY u.id_usuario, r.nombre`,
    [userId],
  );
  const target = result.rows[0];
  if (!target) throw notFound("El usuario no existe.");
  return target;
}

function assertCanManageTarget(actor: SessionUser, target: TargetUserRow): void {
  if (actor.rol === "SUPER_ADMIN") return;
  assertAssignableRole(actor, target.role);
  if (!target.agency_ids.includes(actorAgencyId(actor))) {
    throw forbidden("El usuario no pertenece a tu agencia.");
  }
}

async function getManagedUserById(userId: number): Promise<ManagedUser> {
  const result = await query<ManagedUserRow>(
    `${USER_SELECT}
     WHERE u.id_usuario = $1
     GROUP BY u.id_usuario, p.id_persona, r.nombre, c.id_conductor`,
    [userId],
  );
  if (!result.rows[0]) throw notFound("El usuario no existe.");
  return mapUser(result.rows[0]);
}

export async function createManagedUser(
  actor: SessionUser,
  input: AdminUserCreateInput,
): Promise<{ user: ManagedUser; temporaryPassword: string }> {
  assertAssignableRole(actor, input.role);
  const agencyIds = await resolveAgencyIds(actor, input.agencyIds);
  const createdBy = actorId(actor);
  const temporaryPassword = createTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, PASSWORD_COST);

  const userId = await withTransaction(async (client) => {
    let person;
    try {
      person = await client.query<{ id_persona: number }>(
        `INSERT INTO personas (
           tipo_documento, nro_documento, nombres, apellidos, telefono, email, tipo
         )
         VALUES ('DNI', $1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)
         RETURNING id_persona`,
        [
          input.dni,
          input.names,
          input.surnames,
          input.phone || "",
          input.email || "",
          input.role === "CONDUCTOR" ? "CONDUCTOR" : "EMPLEADO",
        ],
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw conflict(
          "DOCUMENT_ALREADY_EXISTS",
          "El DNI ya está registrado; no se modificó la persona existente.",
        );
      }
      throw error;
    }
    const personId = person.rows[0].id_persona;
    const alreadyLinked = await client.query(
      "SELECT 1 FROM usuarios WHERE id_persona = $1",
      [personId],
    );
    if (alreadyLinked.rowCount) {
      throw conflict("PERSON_ALREADY_HAS_USER", "La persona ya tiene una cuenta.");
    }

    let account;
    try {
      account = await client.query<{ id_usuario: number }>(
        `INSERT INTO usuarios (
           username, password_hash, id_persona, id_rol, estado,
           must_change_password, temporary_password_expires_at
         )
         SELECT $1, $2, $3, role.id_rol, 'ACTIVO', TRUE,
                NOW() + ($5::integer * INTERVAL '1 hour')
         FROM roles role
         WHERE role.nombre = $4
         RETURNING id_usuario`,
        [input.username, passwordHash, personId, input.role, TEMPORARY_PASSWORD_HOURS],
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw conflict("USERNAME_ALREADY_EXISTS", "El nombre de usuario ya existe.");
      }
      throw error;
    }
    const newUserId = account.rows[0]?.id_usuario;
    if (!newUserId) throw new Error("USER_CREATE_FAILED");

    for (const [index, agencyId] of agencyIds.entries()) {
      await client.query(
        `INSERT INTO usuarios_agencias (id_usuario, id_agencia, es_principal, estado)
         VALUES ($1, $2, $3, 'ACTIVO')`,
        [newUserId, agencyId, index === 0],
      );
    }

    if (input.role === "CONDUCTOR" && input.driver) {
      await client.query(
        `INSERT INTO conductores (
           id_persona, id_agencia_base, nro_licencia, categoria_licencia,
           fecha_vencimiento, habilitado
         )
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [
          personId,
          agencyIds[0],
          input.driver.licenseNumber,
          input.driver.licenseCategory,
          input.driver.licenseExpiresAt,
        ],
      );
    }

    await writeAuditLog(
      {
        userId: createdBy,
        agencyId: agencyIds[0],
        action: "USER_CREATED",
        entity: "usuario",
        entityId: formatEntityId("U", newUserId),
        metadata: { role: input.role, agencyIds: input.agencyIds },
      },
      client,
    );
    return newUserId;
  });

  return { user: await getManagedUserById(userId), temporaryPassword };
}

export async function updateManagedUser(
  actor: SessionUser,
  userIdValue: string,
  input: AdminUserUpdateInput,
): Promise<ManagedUser> {
  const userId = parseEntityId(userIdValue, "U");
  if (!userId) throw notFound("El usuario no existe.");
  const target = await findTarget(userId);
  assertCanManageTarget(actor, target);
  if (input.role) assertAssignableRole(actor, input.role);
  if (userId === actorId(actor) && (input.role || (input.state && input.state !== "ACTIVO"))) {
    throw forbidden("No puedes cambiar tu propio rol ni bloquear tu cuenta.");
  }
  const agencyIds = input.agencyIds
    ? await resolveAgencyIds(actor, input.agencyIds)
    : null;
  const nextRole = input.role || target.role;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE personas
       SET nombres = COALESCE($1, nombres),
           apellidos = COALESCE($2, apellidos),
           telefono = CASE WHEN $3::text IS NULL THEN telefono ELSE NULLIF($3, '') END,
           email = CASE WHEN $4::text IS NULL THEN email ELSE NULLIF($4, '') END,
           tipo = CASE WHEN $5 = 'CONDUCTOR' THEN 'CONDUCTOR' ELSE 'EMPLEADO' END,
           updated_at = NOW()
       WHERE id_persona = $6`,
      [input.names ?? null, input.surnames ?? null, input.phone ?? null, input.email ?? null, nextRole, target.id_persona],
    );
    try {
      await client.query(
        `UPDATE usuarios account
         SET username = COALESCE($1, account.username),
             id_rol = COALESCE((SELECT id_rol FROM roles WHERE nombre = $2), account.id_rol),
             estado = COALESCE($3, account.estado),
             password_changed_at = CASE
               WHEN $2::text IS NOT NULL OR $3::text IS NOT NULL THEN NOW()
               ELSE account.password_changed_at
             END,
             updated_at = NOW()
         WHERE id_usuario = $4`,
        [input.username ?? null, input.role ?? null, input.state ?? null, userId],
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw conflict("USERNAME_ALREADY_EXISTS", "El nombre de usuario ya existe.");
      }
      throw error;
    }

    if (agencyIds) {
      await client.query(
        `UPDATE usuarios_agencias SET estado = 'INACTIVO', es_principal = FALSE, updated_at = NOW()
         WHERE id_usuario = $1`,
        [userId],
      );
      for (const [index, agencyId] of agencyIds.entries()) {
        await client.query(
          `INSERT INTO usuarios_agencias (id_usuario, id_agencia, es_principal, estado)
           VALUES ($1, $2, $3, 'ACTIVO')
           ON CONFLICT (id_usuario, id_agencia) DO UPDATE
           SET es_principal = EXCLUDED.es_principal, estado = 'ACTIVO', updated_at = NOW()`,
          [userId, agencyId, index === 0],
        );
      }
    }

    if (nextRole === "CONDUCTOR") {
      if (!input.driver && target.role !== "CONDUCTOR") {
        throw conflict("DRIVER_PROFILE_REQUIRED", "Completa los datos de licencia del conductor.");
      }
      if (input.driver) {
        const baseAgencyId = agencyIds?.[0] || target.agency_ids[0];
        await client.query(
          `INSERT INTO conductores (
             id_persona, id_agencia_base, nro_licencia, categoria_licencia,
             fecha_vencimiento, habilitado
           )
           VALUES ($1, $2, $3, $4, $5, TRUE)
           ON CONFLICT (id_persona) DO UPDATE
           SET id_agencia_base = EXCLUDED.id_agencia_base,
               nro_licencia = EXCLUDED.nro_licencia,
               categoria_licencia = EXCLUDED.categoria_licencia,
               fecha_vencimiento = EXCLUDED.fecha_vencimiento,
               habilitado = TRUE,
               updated_at = NOW()`,
          [target.id_persona, baseAgencyId, input.driver.licenseNumber, input.driver.licenseCategory, input.driver.licenseExpiresAt],
        );
      }
    } else if (target.role === "CONDUCTOR") {
      await client.query(
        "UPDATE conductores SET habilitado = FALSE, updated_at = NOW() WHERE id_persona = $1",
        [target.id_persona],
      );
    }

    if (input.role || input.state || agencyIds) {
      await client.query(
        "UPDATE sesiones SET revoked_at = NOW() WHERE id_usuario = $1 AND revoked_at IS NULL",
        [userId],
      );
    }
    await writeAuditLog(
      {
        userId: actorId(actor),
        agencyId: agencyIds?.[0] || target.agency_ids[0] || null,
        action: "USER_UPDATED",
        entity: "usuario",
        entityId: userIdValue,
        metadata: {
          fields: Object.keys(input).filter((key) => key !== "driver"),
          role: input.role,
          state: input.state,
        },
      },
      client,
    );
  });

  return getManagedUserById(userId);
}

export async function resetManagedUserPassword(
  actor: SessionUser,
  userIdValue: string,
): Promise<{ temporaryPassword: string; expiresAt: string }> {
  const userId = parseEntityId(userIdValue, "U");
  if (!userId) throw notFound("El usuario no existe.");
  const target = await findTarget(userId);
  assertCanManageTarget(actor, target);
  const temporaryPassword = createTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, PASSWORD_COST);
  const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_HOURS * 60 * 60 * 1000);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE usuarios
       SET password_hash = $1,
           must_change_password = TRUE,
           temporary_password_expires_at = $2,
           password_changed_at = NOW(),
           updated_at = NOW()
       WHERE id_usuario = $3`,
      [passwordHash, expiresAt, userId],
    );
    await client.query(
      "UPDATE sesiones SET revoked_at = NOW() WHERE id_usuario = $1 AND revoked_at IS NULL",
      [userId],
    );
    await writeAuditLog(
      {
        userId: actorId(actor),
        agencyId: target.agency_ids[0] || null,
        action: "USER_PASSWORD_RESET",
        entity: "usuario",
        entityId: userIdValue,
        metadata: { expiresAt: expiresAt.toISOString() },
      },
      client,
    );
  });
  return { temporaryPassword, expiresAt: expiresAt.toISOString() };
}

export async function resetManagedUserMfa(
  actor: SessionUser,
  userIdValue: string,
): Promise<void> {
  const userId = parseEntityId(userIdValue, "U");
  if (!userId) throw notFound("El usuario no existe.");
  const target = await findTarget(userId);
  assertCanManageTarget(actor, target);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE usuarios
       SET mfa_enabled = FALSE,
           mfa_secret_encrypted = NULL,
           mfa_enrolled_at = NULL,
           mfa_last_used_step = NULL,
           updated_at = NOW()
       WHERE id_usuario = $1`,
      [userId],
    );
    await client.query(
      "DELETE FROM mfa_recovery_codes WHERE id_usuario = $1",
      [userId],
    );
    await client.query(
      "UPDATE sesiones SET revoked_at = NOW() WHERE id_usuario = $1 AND revoked_at IS NULL",
      [userId],
    );
    await writeAuditLog(
      {
        userId: actorId(actor),
        agencyId: target.agency_ids[0] || null,
        action: "USER_MFA_RESET",
        entity: "usuario",
        entityId: userIdValue,
      },
      client,
    );
  });
}

export async function changeOwnPassword(
  user: SessionUser,
  input: ChangePasswordInput,
): Promise<void> {
  const userId = actorId(user);
  await withTransaction(async (client) => {
    const current = await client.query<{ password_hash: string }>(
      "SELECT password_hash FROM usuarios WHERE id_usuario = $1 AND estado = 'ACTIVO' FOR UPDATE",
      [userId],
    );
    const passwordHash = current.rows[0]?.password_hash;
    if (!passwordHash || !(await bcrypt.compare(input.currentPassword, passwordHash))) {
      throw unauthorized("La contraseña actual no es correcta.");
    }
    const nextHash = await bcrypt.hash(input.newPassword, PASSWORD_COST);
    await client.query(
      `UPDATE usuarios
       SET password_hash = $1,
           must_change_password = FALSE,
           temporary_password_expires_at = NULL,
           password_changed_at = NOW(),
           updated_at = NOW()
       WHERE id_usuario = $2`,
      [nextHash, userId],
    );
    await client.query(
      "UPDATE sesiones SET revoked_at = NOW() WHERE id_usuario = $1 AND revoked_at IS NULL",
      [userId],
    );
    await writeAuditLog(
      {
        userId,
        agencyId: user.agenciaId ? parseEntityId(user.agenciaId, "A") : null,
        action: "USER_PASSWORD_CHANGED",
        entity: "usuario",
        entityId: user.id,
      },
      client,
    );
  });
}

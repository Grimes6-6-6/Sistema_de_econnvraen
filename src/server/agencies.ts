import "server-only";

import type { QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import type { Agency } from "@/lib/domain/agency";
import { formatEntityId, parseEntityId } from "@/lib/domain/ids";
import type { AgencyInput, AgencyUpdateInput } from "@/lib/validation/schemas";
import { writeAuditLog } from "@/server/audit";
import { query, withTransaction } from "@/server/db/pool";
import { conflict, forbidden } from "@/server/errors";

interface AgencyRow extends QueryResultRow {
  id_agencia: number;
  codigo: string;
  nombre: string;
  ciudad: string;
  direccion: string;
  telefono: string | null;
  email: string | null;
  estado: string;
}

function mapAgency(row: AgencyRow): Agency {
  return {
    id: formatEntityId("A", row.id_agencia),
    code: row.codigo,
    name: row.nombre,
    city: row.ciudad,
    address: row.direccion,
    phone: row.telefono || "",
    email: row.email || "",
    isActive: row.estado === "ACTIVA",
  };
}

export async function listAgencies(user: SessionUser): Promise<Agency[]> {
  const userId = parseEntityId(user.id, "U");
  if (!userId) throw forbidden("La sesión no tiene un usuario válido.");

  const result = await query<AgencyRow>(
    `SELECT
       agency.id_agencia,
       agency.codigo,
       agency.nombre,
       agency.ciudad,
       agency.direccion,
       agency.telefono,
       agency.email,
       agency.estado
     FROM agencias agency
     WHERE agency.estado = 'ACTIVA'
       AND (
         $1::boolean
         OR EXISTS (
           SELECT 1
           FROM usuarios_agencias membership
           WHERE membership.id_usuario = $2
             AND membership.id_agencia = agency.id_agencia
             AND membership.estado = 'ACTIVO'
         )
       )
     ORDER BY agency.ciudad, agency.nombre`,
    [user.rol === "SUPER_ADMIN", userId],
  );

  return result.rows.map(mapAgency);
}

export async function createAgency(
  user: SessionUser,
  input: AgencyInput,
): Promise<Agency> {
  if (user.rol !== "SUPER_ADMIN") throw forbidden();
  const userId = parseEntityId(user.id, "U");
  if (!userId) throw forbidden("La sesión no tiene un usuario válido.");

  return withTransaction(async (client) => {
    try {
      const result = await client.query<AgencyRow>(
        `INSERT INTO agencias (
           codigo, nombre, ciudad, direccion, telefono, email
         )
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''))
         RETURNING
           id_agencia, codigo, nombre, ciudad, direccion,
           telefono, email, estado`,
        [
          input.code,
          input.name,
          input.city,
          input.address,
          input.phone || "",
          input.email || "",
        ],
      );
      const created = result.rows[0];
      await writeAuditLog(
        {
          userId,
          agencyId: created.id_agencia,
          action: "AGENCY_CREATED",
          entity: "agencia",
          entityId: formatEntityId("A", created.id_agencia),
          metadata: { code: created.codigo, city: created.ciudad },
        },
        client,
      );
      return mapAgency(created);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw conflict(
          "AGENCY_ALREADY_EXISTS",
          "Ya existe una agencia con ese código, nombre o ciudad.",
        );
      }
      throw error;
    }
  });
}

export async function listAllAgencies(user: SessionUser): Promise<Agency[]> {
  if (user.rol !== "SUPER_ADMIN") throw forbidden();
  const result = await query<AgencyRow>(
    `SELECT id_agencia, codigo, nombre, ciudad, direccion, telefono, email, estado
     FROM agencias
     ORDER BY estado DESC, ciudad, nombre`,
  );
  return result.rows.map(mapAgency);
}

export async function updateAgency(
  user: SessionUser,
  agencyIdValue: string,
  input: AgencyUpdateInput,
): Promise<Agency> {
  if (user.rol !== "SUPER_ADMIN") throw forbidden();
  const userId = parseEntityId(user.id, "U");
  const agencyId = parseEntityId(agencyIdValue, "A");
  if (!userId || !agencyId) throw forbidden("La agencia no es válida.");

  return withTransaction(async (client) => {
    const current = await client.query<AgencyRow>(
      `SELECT id_agencia, codigo, nombre, ciudad, direccion, telefono, email, estado
       FROM agencias WHERE id_agencia = $1 FOR UPDATE`,
      [agencyId],
    );
    if (!current.rows[0]) throw forbidden("La agencia no existe.");

    if (input.state === "INACTIVA") {
      const activeTrips = await client.query(
        `SELECT 1 FROM viajes
         WHERE id_agencia = $1 AND estado IN ('PROGRAMADO', 'EN_CURSO')
         LIMIT 1`,
        [agencyId],
      );
      if (activeTrips.rowCount) {
        throw conflict(
          "AGENCY_HAS_ACTIVE_TRIPS",
          "No se puede desactivar una agencia con viajes pendientes o en curso.",
        );
      }
    }

    const updated = await client.query<AgencyRow>(
      `UPDATE agencias
       SET codigo = COALESCE($1, codigo),
           nombre = COALESCE($2, nombre),
           ciudad = COALESCE($3, ciudad),
           direccion = COALESCE($4, direccion),
           telefono = CASE WHEN $5::text IS NULL THEN telefono ELSE NULLIF($5, '') END,
           email = CASE WHEN $6::text IS NULL THEN email ELSE NULLIF($6, '') END,
           estado = COALESCE($7, estado),
           updated_at = NOW()
       WHERE id_agencia = $8
       RETURNING id_agencia, codigo, nombre, ciudad, direccion, telefono, email, estado`,
      [
        input.code ?? null,
        input.name ?? null,
        input.city ?? null,
        input.address ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.state ?? null,
        agencyId,
      ],
    );
    await writeAuditLog(
      {
        userId,
        agencyId,
        action: "AGENCY_UPDATED",
        entity: "agencia",
        entityId: agencyIdValue,
        metadata: { fields: Object.keys(input), state: input.state },
      },
      client,
    );
    return mapAgency(updated.rows[0]);
  });
}

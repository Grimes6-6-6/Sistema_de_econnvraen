import "server-only";

import type { QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import type { TicketCancellationRequest } from "@/lib/domain/admin";
import { formatEntityId, parseEntityId } from "@/lib/domain/ids";
import type {
  CancellationInput,
  CancellationResolutionInput,
} from "@/lib/validation/schemas";
import { writeAuditLog } from "@/server/audit";
import { query, withTransaction } from "@/server/db/pool";
import { conflict, forbidden, notFound } from "@/server/errors";

interface CancellationRow extends QueryResultRow {
  id_solicitud: number;
  id_boleto: number;
  codigo: string;
  pasajero: string;
  solicitado_por: string;
  motivo_solicitud: string;
  estado: TicketCancellationRequest["state"];
  resuelto_por: string | null;
  motivo_resolucion: string | null;
  requested_at: string;
  resolved_at: string | null;
}

function userId(user: SessionUser): number {
  const id = parseEntityId(user.id, "U");
  if (!id) throw forbidden("La sesión no tiene un usuario válido.");
  return id;
}

function agencyId(user: SessionUser): number {
  const id = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  if (!id) throw forbidden("Selecciona una agencia activa.");
  return id;
}

function parseRequestId(value: string): number {
  const id = parseEntityId(value, "CR");
  if (!id) throw notFound("La solicitud no existe.");
  return id;
}

function mapCancellation(row: CancellationRow): TicketCancellationRequest {
  return {
    id: formatEntityId("CR", row.id_solicitud),
    ticketId: formatEntityId("B", row.id_boleto),
    ticketCode: row.codigo,
    passengerName: row.pasajero,
    requestedBy: row.solicitado_por,
    requestReason: row.motivo_solicitud,
    state: row.estado,
    resolvedBy: row.resuelto_por || "",
    resolutionReason: row.motivo_resolucion || "",
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
  };
}

const CANCELLATION_SELECT = `
  SELECT request.id_solicitud, request.id_boleto, ticket.codigo,
         passenger.nombres || ' ' || passenger.apellidos AS pasajero,
         requester_person.nombres || ' ' || requester_person.apellidos AS solicitado_por,
         request.motivo_solicitud, request.estado,
         COALESCE(resolver_person.nombres || ' ' || resolver_person.apellidos, '') AS resuelto_por,
         request.motivo_resolucion,
         request.requested_at::text,
         request.resolved_at::text
  FROM solicitudes_anulacion_boletos request
  JOIN boletos ticket ON ticket.id_boleto = request.id_boleto
  JOIN personas passenger ON passenger.id_persona = ticket.id_persona_pasajero
  JOIN usuarios requester ON requester.id_usuario = request.solicitado_por
  JOIN personas requester_person ON requester_person.id_persona = requester.id_persona
  LEFT JOIN usuarios resolver ON resolver.id_usuario = request.resuelto_por
  LEFT JOIN personas resolver_person ON resolver_person.id_persona = resolver.id_persona
`;

export async function requestTicketCancellation(
  user: SessionUser,
  ticketIdValue: string,
  input: CancellationInput,
): Promise<TicketCancellationRequest> {
  const ticketId = parseEntityId(ticketIdValue, "B");
  if (!ticketId) throw notFound("El boleto no existe.");
  const activeAgencyId = agencyId(user);
  const requesterId = userId(user);

  const requestId = await withTransaction(async (client) => {
    const ticket = await client.query<{
      id_boleto: number;
      estado: string;
      trip_estado: string;
      fecha_hora_salida: string;
    }>(
      `SELECT ticket.id_boleto, ticket.estado, trip.estado AS trip_estado,
              trip.fecha_hora_salida::text
       FROM boletos ticket
       JOIN viajes trip ON trip.id_viaje = ticket.id_viaje
       WHERE ticket.id_boleto = $1
         AND ticket.id_agencia_venta = $2
       FOR UPDATE OF ticket, trip`,
      [ticketId, activeAgencyId],
    );
    const row = ticket.rows[0];
    if (!row) throw notFound("El boleto no pertenece a tu agencia.");
    if (row.estado !== "ACTIVO") {
      throw conflict("TICKET_ALREADY_CANCELLED", "El boleto ya fue anulado.");
    }
    if (row.trip_estado !== "PROGRAMADO" || new Date(row.fecha_hora_salida).getTime() <= Date.now()) {
      throw conflict("TICKET_NOT_CANCELLABLE", "El viaje ya no admite anulaciones.");
    }
    let created;
    try {
      created = await client.query<{ id_solicitud: number }>(
        `INSERT INTO solicitudes_anulacion_boletos (
           id_boleto, id_agencia, solicitado_por, motivo_solicitud
         )
         VALUES ($1, $2, $3, $4)
         RETURNING id_solicitud`,
        [ticketId, activeAgencyId, requesterId, input.reason],
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw conflict("CANCELLATION_ALREADY_PENDING", "El boleto ya tiene una solicitud pendiente.");
      }
      throw error;
    }
    const id = created.rows[0].id_solicitud;
    await writeAuditLog(
      {
        userId: requesterId,
        agencyId: activeAgencyId,
        action: "TICKET_CANCELLATION_REQUESTED",
        entity: "solicitud_anulacion",
        entityId: formatEntityId("CR", id),
        metadata: { ticketId: ticketIdValue, reason: input.reason },
      },
      client,
    );
    return id;
  });

  const created = await query<CancellationRow>(
    `${CANCELLATION_SELECT} WHERE request.id_solicitud = $1`,
    [requestId],
  );
  return mapCancellation(created.rows[0]);
}

export async function listTicketCancellationRequests(
  user: SessionUser,
): Promise<TicketCancellationRequest[]> {
  const scopeAgencyId = user.rol === "SUPER_ADMIN" ? null : agencyId(user);
  const result = await query<CancellationRow>(
    `${CANCELLATION_SELECT}
     WHERE ($1::integer IS NULL OR request.id_agencia = $1)
     ORDER BY CASE request.estado WHEN 'PENDIENTE' THEN 0 ELSE 1 END,
              request.requested_at DESC
     LIMIT 200`,
    [scopeAgencyId],
  );
  return result.rows.map(mapCancellation);
}

export async function resolveTicketCancellation(
  user: SessionUser,
  requestIdValue: string,
  input: CancellationResolutionInput,
): Promise<TicketCancellationRequest> {
  const cancellationId = parseRequestId(requestIdValue);
  const resolverId = userId(user);
  const scopeAgencyId = user.rol === "SUPER_ADMIN" ? null : agencyId(user);

  await withTransaction(async (client) => {
    const current = await client.query<{
      id_boleto: number;
      id_agencia: number;
      estado: string;
      ticket_estado: string;
      trip_estado: string;
      fecha_hora_salida: string;
    }>(
      `SELECT request.id_boleto, request.id_agencia, request.estado,
              ticket.estado AS ticket_estado, trip.estado AS trip_estado,
              trip.fecha_hora_salida::text
       FROM solicitudes_anulacion_boletos request
       JOIN boletos ticket ON ticket.id_boleto = request.id_boleto
       JOIN viajes trip ON trip.id_viaje = ticket.id_viaje
       WHERE request.id_solicitud = $1
         AND ($2::integer IS NULL OR request.id_agencia = $2)
       FOR UPDATE OF request, ticket, trip`,
      [cancellationId, scopeAgencyId],
    );
    const row = current.rows[0];
    if (!row) throw notFound("La solicitud no pertenece a tu agencia.");
    if (row.estado !== "PENDIENTE") {
      throw conflict("CANCELLATION_ALREADY_RESOLVED", "La solicitud ya fue resuelta.");
    }

    if (input.decision === "APROBADA") {
      if (
        row.ticket_estado !== "ACTIVO" ||
        row.trip_estado !== "PROGRAMADO" ||
        new Date(row.fecha_hora_salida).getTime() <= Date.now()
      ) {
        throw conflict("TICKET_NOT_CANCELLABLE", "El boleto ya no puede anularse.");
      }
      await client.query(
        `UPDATE boletos
         SET estado = 'ANULADO', anulado_por = $1, anulado_at = NOW(),
             motivo_anulacion = $2, nota_credito_estado = 'PENDIENTE'
         WHERE id_boleto = $3`,
        [resolverId, input.reason, row.id_boleto],
      );
    }

    await client.query(
      `UPDATE solicitudes_anulacion_boletos
       SET estado = $1, resuelto_por = $2, motivo_resolucion = $3,
           resolved_at = NOW(), updated_at = NOW()
       WHERE id_solicitud = $4`,
      [input.decision, resolverId, input.reason, cancellationId],
    );
    await writeAuditLog(
      {
        userId: resolverId,
        agencyId: row.id_agencia,
        action:
          input.decision === "APROBADA"
            ? "TICKET_CANCELLATION_APPROVED"
            : "TICKET_CANCELLATION_REJECTED",
        entity: "solicitud_anulacion",
        entityId: requestIdValue,
        metadata: {
          ticketId: formatEntityId("B", row.id_boleto),
          reason: input.reason,
        },
      },
      client,
    );
  });

  const resolved = await query<CancellationRow>(
    `${CANCELLATION_SELECT} WHERE request.id_solicitud = $1`,
    [cancellationId],
  );
  return mapCancellation(resolved.rows[0]);
}

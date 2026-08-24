import "server-only";

import type { QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import type { OperationalDocument } from "@/lib/domain/admin";
import { formatEntityId, parseEntityId } from "@/lib/domain/ids";
import type { OperationalDocumentInput } from "@/lib/validation/schemas";
import { writeAuditLog } from "@/server/audit";
import { query, withTransaction } from "@/server/db/pool";
import { forbidden, notFound } from "@/server/errors";

interface DocumentRow extends QueryResultRow {
  id_documento: number;
  titular_tipo: OperationalDocument["holderType"];
  id_conductor: number | null;
  id_vehiculo: number | null;
  titular_nombre: string;
  tipo_documento: OperationalDocument["documentType"];
  numero: string;
  fecha_emision: string | null;
  fecha_vencimiento: string;
  estado: OperationalDocument["state"];
  observacion: string | null;
}

function actorId(user: SessionUser): number {
  const id = parseEntityId(user.id, "U");
  if (!id) throw forbidden();
  return id;
}

function scopeAgencyId(user: SessionUser): number | null {
  if (user.rol === "SUPER_ADMIN") return null;
  const id = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  if (!id) throw forbidden("Selecciona una agencia activa.");
  return id;
}

function mapDocument(row: DocumentRow): OperationalDocument {
  const holderId = row.titular_tipo === "CONDUCTOR"
    ? formatEntityId("C", row.id_conductor!, 2)
    : formatEntityId("V", row.id_vehiculo!, 2);
  return {
    id: formatEntityId("DOC", row.id_documento),
    holderType: row.titular_tipo,
    holderId,
    holderName: row.titular_nombre,
    documentType: row.tipo_documento,
    number: row.numero,
    issuedAt: row.fecha_emision || "",
    expiresAt: row.fecha_vencimiento,
    state: row.estado,
    notes: row.observacion || "",
  };
}

const DOCUMENT_SELECT = `
  SELECT document.id_documento, document.titular_tipo,
         document.id_conductor, document.id_vehiculo,
         CASE
           WHEN document.titular_tipo = 'CONDUCTOR'
             THEN driver_person.nombres || ' ' || driver_person.apellidos
           ELSE vehicle.placa || ' · ' || vehicle.marca || ' ' || vehicle.modelo
         END AS titular_nombre,
         document.tipo_documento, document.numero,
         document.fecha_emision::text, document.fecha_vencimiento::text,
         CASE
           WHEN document.estado <> 'OBSERVADO' AND document.fecha_vencimiento < CURRENT_DATE THEN 'VENCIDO'
           WHEN document.estado <> 'OBSERVADO' AND document.fecha_vencimiento <= CURRENT_DATE + 30 THEN 'POR_VENCER'
           ELSE document.estado
         END AS estado,
         document.observacion
  FROM documentos_operativos document
  LEFT JOIN conductores driver ON driver.id_conductor = document.id_conductor
  LEFT JOIN personas driver_person ON driver_person.id_persona = driver.id_persona
  LEFT JOIN vehiculos vehicle ON vehicle.id_vehiculo = document.id_vehiculo
`;

export async function listOperationalDocuments(
  user: SessionUser,
): Promise<OperationalDocument[]> {
  const agencyId = scopeAgencyId(user);
  const result = await query<DocumentRow>(
    `${DOCUMENT_SELECT}
     WHERE ($1::integer IS NULL OR document.id_agencia = $1)
     ORDER BY document.fecha_vencimiento, titular_nombre`,
    [agencyId],
  );
  return result.rows.map(mapDocument);
}

export async function createOperationalDocument(
  user: SessionUser,
  input: OperationalDocumentInput,
): Promise<OperationalDocument> {
  const activeAgencyId = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  if (!activeAgencyId) throw forbidden("Selecciona la agencia del documento.");
  const holderId = parseEntityId(
    input.holderId,
    input.holderType === "CONDUCTOR" ? "C" : "V",
  );
  if (!holderId) throw notFound("El titular no existe.");

  const documentId = await withTransaction(async (client) => {
    const holder = await client.query(
      input.holderType === "CONDUCTOR"
        ? "SELECT 1 FROM conductores WHERE id_conductor = $1 AND id_agencia_base = $2"
        : "SELECT 1 FROM vehiculos WHERE id_vehiculo = $1 AND id_agencia_base = $2",
      [holderId, activeAgencyId],
    );
    if (!holder.rowCount) throw notFound("El titular no pertenece a la agencia.");
    const created = await client.query<{ id_documento: number }>(
      `INSERT INTO documentos_operativos (
         id_agencia, titular_tipo, id_conductor, id_vehiculo,
         tipo_documento, numero, fecha_emision, fecha_vencimiento,
         estado, observacion, creado_por
       )
       VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::date, $8, $9, NULLIF($10, ''), $11)
       RETURNING id_documento`,
      [
        activeAgencyId,
        input.holderType,
        input.holderType === "CONDUCTOR" ? holderId : null,
        input.holderType === "VEHICULO" ? holderId : null,
        input.documentType,
        input.number,
        input.issuedAt || "",
        input.expiresAt,
        input.state,
        input.notes || "",
        actorId(user),
      ],
    );
    const id = created.rows[0].id_documento;
    await writeAuditLog(
      {
        userId: actorId(user),
        agencyId: activeAgencyId,
        action: "OPERATIONAL_DOCUMENT_CREATED",
        entity: "documento_operativo",
        entityId: formatEntityId("DOC", id),
        metadata: {
          holderType: input.holderType,
          holderId: input.holderId,
          documentType: input.documentType,
          expiresAt: input.expiresAt,
        },
      },
      client,
    );
    return id;
  });

  const result = await query<DocumentRow>(
    `${DOCUMENT_SELECT} WHERE document.id_documento = $1`,
    [documentId],
  );
  return mapDocument(result.rows[0]);
}

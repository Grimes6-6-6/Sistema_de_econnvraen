import "server-only";

import type { QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import {
  isVehicleDocumentType,
  type OperationalDocument,
} from "@/lib/domain/admin";
import { roleHasPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { formatEntityId, parseEntityId } from "@/lib/domain/ids";
import type {
  DriverOperationalDocumentInput,
  OperationalDocumentInput,
  OperationalDocumentReviewInput,
} from "@/lib/validation/schemas";
import type { AllowedDocumentMime } from "@/lib/security/document-files";
import { writeAuditLog } from "@/server/audit";
import { query, withTransaction } from "@/server/db/pool";
import { conflict, forbidden, notFound } from "@/server/errors";

interface DocumentRow extends QueryResultRow {
  id_documento: number | string;
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
  origen_registro: OperationalDocument["source"];
  archivo_nombre: string | null;
  archivo_mime: AllowedDocumentMime | null;
  archivo_tamano: number | null;
}

interface DocumentFileRow extends QueryResultRow {
  id_agencia: number;
  id_conductor: number | null;
  id_vehiculo: number | null;
  creado_por: number | null;
  archivo_nombre: string | null;
  archivo_mime: AllowedDocumentMime | null;
  archivo_contenido: Buffer | null;
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
  const formattedId = formatEntityId("DOC", Number(row.id_documento));
  const holderId = row.titular_tipo === "CONDUCTOR"
    ? formatEntityId("C", row.id_conductor!, 2)
    : formatEntityId("V", row.id_vehiculo!, 2);
  return {
    id: formattedId,
    holderType: row.titular_tipo,
    holderId,
    holderName: row.titular_nombre,
    documentType: row.tipo_documento,
    number: row.numero,
    issuedAt: row.fecha_emision || "",
    expiresAt: row.fecha_vencimiento,
    state: row.estado,
    notes: row.observacion || "",
    source: row.origen_registro,
    file:
      row.archivo_nombre && row.archivo_mime && row.archivo_tamano
        ? {
            name: row.archivo_nombre,
            mimeType: row.archivo_mime,
            size: row.archivo_tamano,
            downloadUrl: `/api/documents/${formattedId}/file`,
          }
        : null,
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
           WHEN document.estado IN ('PENDIENTE', 'OBSERVADO') THEN document.estado
           WHEN document.fecha_vencimiento < CURRENT_DATE THEN 'VENCIDO'
           WHEN document.fecha_vencimiento <= CURRENT_DATE + 30 THEN 'POR_VENCER'
           ELSE document.estado
         END AS estado,
         document.observacion, document.origen_registro,
         document.archivo_nombre, document.archivo_mime, document.archivo_tamano
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
  if (user.rol !== "SUPER_ADMIN") {
    throw forbidden("Solo el superadministrador puede registrar documentos verificados.");
  }
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
         estado, observacion, creado_por, revisado_por, revisado_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::date, $8, $9, NULLIF($10, ''), $11, $11, NOW())
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
    const id = Number(created.rows[0].id_documento);
    if (
      input.holderType === "CONDUCTOR" &&
      ["DNI", "LICENCIA"].includes(input.documentType)
    ) {
      await client.query(
        `UPDATE conductores
         SET identidad_estado = 'PENDIENTE',
             identidad_observacion = NULL,
             identidad_verificada_por = NULL,
             identidad_verificada_at = NULL,
             updated_at = NOW()
         WHERE id_conductor = $1`,
        [holderId],
      );
    }
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

export async function listDriverOperationalDocuments(
  user: SessionUser,
): Promise<OperationalDocument[]> {
  const driverId = user.conductorId
    ? parseEntityId(user.conductorId, "C")
    : null;
  const agencyId = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  if (!driverId || !agencyId) throw forbidden("No se encontró tu perfil de conductor.");

  const result = await query<DocumentRow>(
    `${DOCUMENT_SELECT}
     WHERE document.id_agencia = $1
       AND (
         document.id_conductor = $2
         OR (document.id_vehiculo IS NOT NULL AND document.creado_por = $3)
       )
     ORDER BY document.id_documento DESC`,
    [agencyId, driverId, actorId(user)],
  );
  return result.rows.map(mapDocument);
}

interface DriverDocumentFileInput {
  name: string;
  mimeType: AllowedDocumentMime;
  size: number;
  sha256: string;
  contents: Buffer;
}

export async function uploadDriverOperationalDocument(
  user: SessionUser,
  input: DriverOperationalDocumentInput,
  file: DriverDocumentFileInput,
): Promise<OperationalDocument> {
  const driverId = user.conductorId
    ? parseEntityId(user.conductorId, "C")
    : null;
  const agencyId = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  if (!driverId || !agencyId) throw forbidden("No se encontró tu perfil de conductor.");

  const vehicleDocument = isVehicleDocumentType(input.documentType);
  const vehicleId = vehicleDocument && input.vehicleId
    ? parseEntityId(input.vehicleId, "V")
    : null;
  if (vehicleDocument && !vehicleId) {
    throw notFound("El vehículo seleccionado no existe.");
  }

  const documentId = await withTransaction(async (client) => {
    if (vehicleId) {
      const assignedVehicle = await client.query(
        `SELECT 1
         FROM vehiculos vehicle
         WHERE vehicle.id_vehiculo = $1
           AND vehicle.id_agencia_base = $2
           AND EXISTS (
             SELECT 1
             FROM viajes trip
             WHERE trip.id_vehiculo = vehicle.id_vehiculo
               AND trip.id_conductor = $3
           )`,
        [vehicleId, agencyId, driverId],
      );
      if (!assignedVehicle.rowCount) {
        throw forbidden("Solo puedes adjuntar documentos de un vehículo que tengas asignado.");
      }
    }

    const created = await client.query<{ id_documento: number }>(
      `INSERT INTO documentos_operativos (
         id_agencia, titular_tipo, id_conductor, id_vehiculo,
         tipo_documento, numero, fecha_emision, fecha_vencimiento,
         estado, observacion, creado_por, origen_registro,
         archivo_nombre, archivo_mime, archivo_tamano, archivo_sha256,
         archivo_contenido
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, NULLIF($7, '')::date, $8,
         'PENDIENTE', NULLIF($9, ''), $10, 'CONDUCTOR',
         $11, $12, $13, $14, $15
       )
       ON CONFLICT DO UPDATE SET
         fecha_emision = EXCLUDED.fecha_emision,
         fecha_vencimiento = EXCLUDED.fecha_vencimiento,
         estado = 'PENDIENTE',
         observacion = EXCLUDED.observacion,
         creado_por = EXCLUDED.creado_por,
         origen_registro = 'CONDUCTOR',
         archivo_nombre = EXCLUDED.archivo_nombre,
         archivo_mime = EXCLUDED.archivo_mime,
         archivo_tamano = EXCLUDED.archivo_tamano,
         archivo_sha256 = EXCLUDED.archivo_sha256,
         archivo_contenido = EXCLUDED.archivo_contenido,
         revisado_por = NULL,
         revisado_at = NULL,
         updated_at = NOW()
       RETURNING id_documento`,
      [
        agencyId,
        vehicleId ? "VEHICULO" : "CONDUCTOR",
        vehicleId ? null : driverId,
        vehicleId,
        input.documentType,
        input.number,
        input.issuedAt || "",
        input.expiresAt,
        input.notes || "",
        actorId(user),
        file.name,
        file.mimeType,
        file.size,
        file.sha256,
        file.contents,
      ],
    );
    const id = Number(created.rows[0].id_documento);
    if (!vehicleId && ["DNI", "LICENCIA"].includes(input.documentType)) {
      await client.query(
        `UPDATE conductores
         SET identidad_estado = 'PENDIENTE',
             identidad_observacion = NULL,
             identidad_verificada_por = NULL,
             identidad_verificada_at = NULL,
             updated_at = NOW()
         WHERE id_conductor = $1`,
        [driverId],
      );
    }
    await writeAuditLog(
      {
        userId: actorId(user),
        agencyId,
        action: "DRIVER_DOCUMENT_UPLOADED",
        entity: "documento_operativo",
        entityId: formatEntityId("DOC", id),
        metadata: {
          documentType: input.documentType,
          holderType: vehicleId ? "VEHICULO" : "CONDUCTOR",
          expiresAt: input.expiresAt,
          fileSha256: file.sha256,
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

export async function reviewOperationalDocument(
  user: SessionUser,
  documentValue: string,
  input: OperationalDocumentReviewInput,
): Promise<OperationalDocument> {
  if (user.rol !== "SUPER_ADMIN") {
    throw forbidden("Solo el superadministrador puede aprobar documentos de conductores.");
  }
  const documentId = parseEntityId(documentValue, "DOC");
  if (!documentId) throw notFound("El documento no existe.");
  const agencyScope = scopeAgencyId(user);

  await withTransaction(async (client) => {
    const document = await client.query<{
      id_agencia: number;
      id_conductor: number | null;
      tipo_documento: OperationalDocument["documentType"];
      numero: string;
      fecha_vencimiento: string;
      estado: OperationalDocument["state"];
    }>(
      `SELECT id_agencia, id_conductor, tipo_documento, numero,
              fecha_vencimiento::text, estado
       FROM documentos_operativos
       WHERE id_documento = $1
         AND ($2::integer IS NULL OR id_agencia = $2)
       FOR UPDATE`,
      [documentId, agencyScope],
    );
    const current = document.rows[0];
    if (!current) throw notFound("El documento no existe en tu ámbito de gestión.");
    if (!['PENDIENTE', 'OBSERVADO'].includes(current.estado)) {
      throw conflict("DOCUMENT_ALREADY_REVIEWED", "El documento ya fue revisado.");
    }

    const updated = await client.query<{ estado: OperationalDocument["state"] }>(
      `UPDATE documentos_operativos
       SET estado = CASE
             WHEN $1::text = 'OBSERVAR' THEN 'OBSERVADO'
             WHEN fecha_vencimiento < CURRENT_DATE THEN 'VENCIDO'
             WHEN fecha_vencimiento <= CURRENT_DATE + 30 THEN 'POR_VENCER'
             ELSE 'VIGENTE'
           END,
           observacion = NULLIF($2, ''),
           revisado_por = $3,
           revisado_at = NOW(),
           updated_at = NOW()
       WHERE id_documento = $4
       RETURNING estado`,
      [input.decision, input.reason || "", actorId(user), documentId],
    );
    const nextState = updated.rows[0].estado;

    if (
      input.decision === "APROBAR" &&
      current.tipo_documento === "LICENCIA" &&
      current.id_conductor
    ) {
      await client.query(
        `UPDATE conductores
         SET nro_licencia = $1, fecha_vencimiento = $2::date
         WHERE id_conductor = $3`,
        [current.numero, current.fecha_vencimiento, current.id_conductor],
      );
    }

    if (
      current.id_conductor &&
      ["DNI", "LICENCIA"].includes(current.tipo_documento)
    ) {
      await client.query(
        `UPDATE conductores
         SET identidad_estado = $1,
             identidad_observacion = NULLIF($2, ''),
             identidad_verificada_por = CASE WHEN $1 = 'OBSERVADA' THEN $3 ELSE NULL END,
             identidad_verificada_at = CASE WHEN $1 = 'OBSERVADA' THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE id_conductor = $4`,
        [
          input.decision === "OBSERVAR" ? "OBSERVADA" : "PENDIENTE",
          input.decision === "OBSERVAR" ? input.reason || "" : "",
          actorId(user),
          current.id_conductor,
        ],
      );
    }

    await writeAuditLog(
      {
        userId: actorId(user),
        agencyId: current.id_agencia,
        action: input.decision === "APROBAR"
          ? "DRIVER_DOCUMENT_APPROVED"
          : "DRIVER_DOCUMENT_OBSERVED",
        entity: "documento_operativo",
        entityId: documentValue,
        metadata: { reason: input.reason || null, nextState },
      },
      client,
    );
  });

  const result = await query<DocumentRow>(
    `${DOCUMENT_SELECT} WHERE document.id_documento = $1`,
    [documentId],
  );
  return mapDocument(result.rows[0]);
}

export async function getDriverIdentityVerification(
  user: SessionUser,
): Promise<{
  state: "PENDIENTE" | "VERIFICADA" | "OBSERVADA";
  observation: string;
}> {
  const driverId = user.conductorId
    ? parseEntityId(user.conductorId, "C")
    : null;
  const agencyId = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  if (!driverId || !agencyId) throw forbidden("No se encontró tu perfil de conductor.");
  const result = await query<{
    identidad_estado: "PENDIENTE" | "VERIFICADA" | "OBSERVADA";
    identidad_observacion: string | null;
  }>(
    `SELECT identidad_estado, identidad_observacion
     FROM conductores
     WHERE id_conductor = $1 AND id_agencia_base = $2`,
    [driverId, agencyId],
  );
  const row = result.rows[0];
  if (!row) throw notFound("No se encontró tu perfil de conductor.");
  return {
    state: row.identidad_estado,
    observation: row.identidad_observacion || "",
  };
}

export async function getOperationalDocumentFile(
  user: SessionUser,
  documentValue: string,
): Promise<{ name: string; mimeType: AllowedDocumentMime; contents: Buffer }> {
  const documentId = parseEntityId(documentValue, "DOC");
  if (!documentId) throw notFound("El documento no existe.");
  const result = await query<DocumentFileRow>(
    `SELECT id_agencia, id_conductor, id_vehiculo, creado_por,
            archivo_nombre, archivo_mime, archivo_contenido
     FROM documentos_operativos
     WHERE id_documento = $1`,
    [documentId],
  );
  const row = result.rows[0];
  if (!row || !row.archivo_nombre || !row.archivo_mime || !row.archivo_contenido) {
    throw notFound("El archivo adjunto no está disponible.");
  }

  const userId = actorId(user);
  const userAgency = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  const driverId = user.conductorId ? parseEntityId(user.conductorId, "C") : null;
  const canManage = roleHasPermission(user.rol, PERMISSIONS.FLEET_MANAGE) &&
    (user.rol === "SUPER_ADMIN" || (userAgency !== null && row.id_agencia === userAgency));
  const ownsDriverFile = user.rol === "CONDUCTOR" && (
    row.id_conductor === driverId || row.creado_por === userId
  );
  if (!canManage && !ownsDriverFile) throw forbidden();

  return {
    name: row.archivo_nombre,
    mimeType: row.archivo_mime,
    contents: row.archivo_contenido,
  };
}

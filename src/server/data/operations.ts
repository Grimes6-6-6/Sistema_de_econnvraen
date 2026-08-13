import "server-only";

import type { QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import {
  type Boleto,
  type Conductor,
  type DatabaseState,
  EMPTY_DATABASE_STATE,
  type Encomienda,
  type PublicTrackingResult,
  type Recojo,
  type Ruta,
  type TrackingHistorico,
  type Vehiculo,
  type VehicleLocation,
  type Viaje,
} from "@/lib/domain/types";
import { formatEntityId, parseEntityId } from "@/lib/domain/ids";
import { canAdvanceParcelStatus } from "@/lib/domain/rules";
import type {
  ParcelInput,
  ParcelStatusInput,
  PickupAssignmentInput,
  PickupInput,
  PickupStatusInput,
  TicketInput,
  TripInput,
  TripStatusInput,
  VehicleLocationUpdateInput,
} from "@/lib/validation/schemas";
import { conflict, forbidden, notFound } from "@/server/errors";
import { query, withTransaction } from "@/server/db/pool";
import { writeAuditLog } from "@/server/audit";

type QueryExecutor = {
  query<Row extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
};

interface RouteRow extends QueryResultRow {
  id_ruta: number;
  origen: string;
  destino: string;
  distancia_km: string;
  duracion_horas: string;
  precio_base: string;
}

interface VehicleRow extends QueryResultRow {
  id_vehiculo: number;
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  capacidad: number;
  estado: string;
}

interface DriverRow extends QueryResultRow {
  id_conductor: number;
  nombres: string;
  apellidos: string;
  nro_licencia: string;
  categoria_licencia: string;
  fecha_vencimiento: string;
}

interface TripRow extends QueryResultRow {
  id_viaje: number;
  id_ruta: number;
  id_vehiculo: number;
  id_conductor: number;
  fecha: string;
  hora: string;
  estado: string;
  precio_final: string;
}

interface TicketRow extends QueryResultRow {
  id_boleto: number;
  codigo: string;
  id_viaje: number;
  asiento: number;
  pasajero_dni: string;
  pasajero_nombres: string;
  pasajero_apellidos: string;
  pasajero_telefono: string;
  precio: string;
  fecha_emision: string;
  estado: string;
  sunat_estado: string;
}

interface ParcelRow extends QueryResultRow {
  id_encomienda: number;
  codigo_tracking: string;
  id_viaje: number;
  remitente_dni: string;
  remitente_nombres: string;
  remitente_apellidos: string;
  remitente_telefono: string;
  destinatario_dni: string;
  destinatario_nombres: string;
  destinatario_apellidos: string;
  destinatario_telefono: string;
  peso_kg: string;
  valor_declarado: string;
  costo: string;
  descripcion: string;
  estado: string;
  fecha_registro: string;
}

interface TrackingRow extends QueryResultRow {
  id_encomienda: number;
  estado: string;
  fecha_hora: string;
  ubicacion: string;
  responsable: string;
  evidencia: Record<string, unknown> | null;
}

interface PickupRow extends QueryResultRow {
  id_solicitud: number;
  dni: string;
  nombres: string;
  apellidos: string;
  telefono_contacto: string;
  fecha_solicitada: string;
  direccion: string;
  descripcion: string;
  estado: string;
  asignado: string | null;
}

interface NumericIdRow extends QueryResultRow {
  id: number;
}

interface VehicleLocationRow extends QueryResultRow {
  id_conductor: number;
  conductor_name: string;
  route_label: string | null;
  placa: string | null;
  latitude: string;
  longitude: string;
  accuracy_m: string;
  speed_kmh: string | null;
  heading: string | null;
  timestamp_ms: string;
  is_active: boolean;
}

const DRIVER_ROLES = ["CONDUCTOR", "ADMINISTRADOR"] as const;
const OPERATOR_ROLES = ["OPERADOR", "ADMINISTRADOR"] as const;

const STATUS_TO_DB: Record<Encomienda["estado"], string> = {
  registrado: "REGISTRADO",
  recojo_domicilio: "RECOJO_DOMICILIO",
  en_transito: "EN_TRANSITO",
  en_destino: "EN_DESTINO",
  entregado: "ENTREGADO",
};

const STATUS_FROM_DB: Record<string, Encomienda["estado"]> = {
  REGISTRADO: "registrado",
  RECOJO_DOMICILIO: "recojo_domicilio",
  EN_TRANSITO: "en_transito",
  EN_DESTINO: "en_destino",
  ENTREGADO: "entregado",
};

const TRIP_STATUS_FROM_DB: Record<string, Viaje["estado"]> = {
  PROGRAMADO: "programado",
  EN_CURSO: "en_curso",
  COMPLETADO: "completado",
  CANCELADO: "cancelado",
};

const PICKUP_STATUS_FROM_DB: Record<string, Recojo["estado"]> = {
  PENDIENTE: "pendiente",
  ASIGNADO: "asignado",
  COMPLETADO: "completado",
  CANCELADO: "cancelado",
};

const DEFAULT_LOCATIONS: Record<Encomienda["estado"], string> = {
  registrado: "Oficina Ayacucho",
  recojo_domicilio: "Recojo a domicilio",
  en_transito: "En ruta Ayacucho - VRAEM",
  en_destino: "Agencia de destino",
  entregado: "Entregado al destinatario",
};

function asNumber(value: string | number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function mapRoute(row: RouteRow): Ruta {
  return {
    id: formatEntityId("R", row.id_ruta, 2),
    origen: row.origen,
    destino: row.destino,
    distancia: `${asNumber(row.distancia_km)}km`,
    duracion: `${asNumber(row.duracion_horas)}h`,
    precio: asNumber(row.precio_base),
  };
}

function mapVehicle(row: VehicleRow): Vehiculo {
  return {
    id: formatEntityId("V", row.id_vehiculo, 2),
    placa: row.placa,
    tipo: row.tipo,
    marca: row.marca,
    modelo: row.modelo,
    capacidad: row.capacidad,
    estado: row.estado.toLowerCase(),
  };
}

function mapDriver(row: DriverRow): Conductor {
  return {
    id: formatEntityId("C", row.id_conductor, 2),
    nombres: `${row.nombres} ${row.apellidos}`.trim(),
    nroLicencia: row.nro_licencia,
    categoria: row.categoria_licencia,
    vencimiento: row.fecha_vencimiento,
  };
}

function mapTrip(row: TripRow): Viaje {
  return {
    id: formatEntityId("T", row.id_viaje, 3),
    id_ruta: formatEntityId("R", row.id_ruta, 2),
    id_vehiculo: formatEntityId("V", row.id_vehiculo, 2),
    id_conductor: formatEntityId("C", row.id_conductor, 2),
    fecha: row.fecha,
    hora: row.hora,
    estado: TRIP_STATUS_FROM_DB[row.estado] || "programado",
    precio: asNumber(row.precio_final),
  };
}

function mapTicket(row: TicketRow): Boleto {
  return {
    id: formatEntityId("B", row.id_boleto, 3),
    codigo: row.codigo,
    id_viaje: formatEntityId("T", row.id_viaje, 3),
    asiento: row.asiento,
    pasajeroDni: row.pasajero_dni,
    pasajeroNombres: row.pasajero_nombres,
    pasajeroApellidos: row.pasajero_apellidos,
    pasajeroTelefono: row.pasajero_telefono,
    precio: asNumber(row.precio),
    fechaEmision: row.fecha_emision,
    estado: row.estado === "ANULADO" ? "anulado" : "activo",
    sunat_estado: row.sunat_estado.toLowerCase(),
  };
}

function mapParcel(
  row: ParcelRow,
  history: TrackingHistorico[],
): Encomienda {
  return {
    id: formatEntityId("E", row.id_encomienda, 3),
    codigo_tracking: row.codigo_tracking,
    id_viaje: formatEntityId("T", row.id_viaje, 3),
    remitenteDni: row.remitente_dni,
    remitenteNombre: `${row.remitente_nombres} ${row.remitente_apellidos}`.trim(),
    remitenteTelefono: row.remitente_telefono,
    destinatarioDni: row.destinatario_dni,
    destinatarioNombre:
      `${row.destinatario_nombres} ${row.destinatario_apellidos}`.trim(),
    destinatarioTelefono: row.destinatario_telefono,
    peso: asNumber(row.peso_kg),
    valor: asNumber(row.valor_declarado),
    costo: asNumber(row.costo),
    descripcion: row.descripcion,
    estado: STATUS_FROM_DB[row.estado] || "registrado",
    fechaRegistro: row.fecha_registro,
    historial: history,
  };
}

function mapPickup(row: PickupRow): Recojo {
  return {
    id: formatEntityId("P", row.id_solicitud, 3),
    dni: row.dni,
    nombre: `${row.nombres} ${row.apellidos}`.trim(),
    telefono: row.telefono_contacto,
    fecha: row.fecha_solicitada,
    direccion: row.direccion,
    descripcion: row.descripcion,
    estado: PICKUP_STATUS_FROM_DB[row.estado] || "pendiente",
    asignado: row.asignado || "",
  };
}

async function getConductorId(userId: number): Promise<number | null> {
  const result = await query<NumericIdRow>(
    `SELECT c.id_conductor AS id
     FROM conductores c
     JOIN usuarios u ON u.id_persona = c.id_persona
     WHERE u.id_usuario = $1
     LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.id || null;
}

function requireAgencyId(user: SessionUser): number {
  const agencyId = user.agenciaId
    ? parseEntityId(user.agenciaId, "A")
    : null;
  if (!agencyId) {
    throw forbidden("Selecciona una agencia activa para continuar.");
  }
  return agencyId;
}

function agencyScopeId(user: SessionUser): number | null {
  return user.rol === "SUPER_ADMIN" ? null : requireAgencyId(user);
}

async function readSnapshot(
  executor: QueryExecutor,
  user: SessionUser,
): Promise<DatabaseState> {
  const userId = parseEntityId(user.id, "U");
  if (!userId) return EMPTY_DATABASE_STATE;
  const agencyId = agencyScopeId(user);
  const driverId = user.rol === "CONDUCTOR" ? await getConductorId(userId) : null;

  if (user.rol === "CONDUCTOR" && !driverId) {
    throw forbidden("Tu usuario no está vinculado a un conductor habilitado.");
  }

  const [routes, vehicles, drivers, trips, tickets, parcels, tracking, pickups] =
    await Promise.all([
      executor.query<RouteRow>(
        `SELECT id_ruta, origen, destino, distancia_km::text, duracion_horas::text,
                precio_base::text
         FROM rutas
         WHERE estado = 'ACTIVO'
           AND (
             $1::integer IS NULL
             OR id_agencia_origen = $1
             OR id_agencia_destino = $1
           )
         ORDER BY origen, destino`,
        [agencyId],
      ),
      executor.query<VehicleRow>(
        `SELECT id_vehiculo, placa, tipo, marca, modelo, capacidad, estado
         FROM vehiculos
         WHERE $1::integer IS NULL OR id_agencia_base = $1
         ORDER BY placa`,
        [agencyId],
      ),
      executor.query<DriverRow>(
        `SELECT c.id_conductor, p.nombres, p.apellidos, c.nro_licencia,
                c.categoria_licencia, c.fecha_vencimiento::text
         FROM conductores c
         JOIN personas p ON p.id_persona = c.id_persona
         WHERE c.habilitado = TRUE
           AND ($1::integer IS NULL OR c.id_agencia_base = $1)
         ORDER BY p.apellidos, p.nombres`,
        [agencyId],
      ),
      executor.query<TripRow>(
        `SELECT v.id_viaje, v.id_ruta, v.id_vehiculo, v.id_conductor,
                TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
                TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
                v.estado, v.precio_final::text
         FROM viajes v
         WHERE ($1::integer IS NULL OR v.id_agencia = $1)
           AND ($2::integer IS NULL OR v.id_conductor = $2)
         ORDER BY v.fecha_hora_salida`,
        [agencyId, driverId],
      ),
      executor.query<TicketRow>(
        `SELECT b.id_boleto, b.codigo, b.id_viaje, b.asiento,
                p.nro_documento AS pasajero_dni,
                p.nombres AS pasajero_nombres,
                p.apellidos AS pasajero_apellidos,
                COALESCE(p.telefono, '') AS pasajero_telefono,
                b.precio::text,
                TO_CHAR(b.fecha_emision AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS fecha_emision,
                b.estado, b.sunat_estado
         FROM boletos b
         JOIN personas p ON p.id_persona = b.id_persona_pasajero
         JOIN viajes v ON v.id_viaje = b.id_viaje
         WHERE ($1::integer IS NULL OR v.id_agencia = $1)
           AND ($2::integer IS NULL OR v.id_conductor = $2)
         ORDER BY b.fecha_emision DESC`,
        [agencyId, driverId],
      ),
      executor.query<ParcelRow>(
        `SELECT e.id_encomienda, e.codigo_tracking, e.id_viaje,
                sr.nro_documento AS remitente_dni,
                sr.nombres AS remitente_nombres,
                sr.apellidos AS remitente_apellidos,
                COALESCE(sr.telefono, '') AS remitente_telefono,
                sd.nro_documento AS destinatario_dni,
                sd.nombres AS destinatario_nombres,
                sd.apellidos AS destinatario_apellidos,
                COALESCE(sd.telefono, '') AS destinatario_telefono,
                e.peso_kg::text, e.valor_declarado::text, e.costo::text,
                e.descripcion, e.estado,
                TO_CHAR(e.fecha_registro AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha_registro
         FROM encomiendas e
         JOIN personas sr ON sr.id_persona = e.id_persona_remitente
         JOIN personas sd ON sd.id_persona = e.id_persona_destinatario
         JOIN viajes v ON v.id_viaje = e.id_viaje
         WHERE ($1::integer IS NULL OR v.id_agencia = $1)
           AND ($2::integer IS NULL OR v.id_conductor = $2)
         ORDER BY e.fecha_registro DESC`,
        [agencyId, driverId],
      ),
      executor.query<TrackingRow>(
        `SELECT t.id_encomienda, t.estado,
                TO_CHAR(t.fecha_hora AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS fecha_hora,
                t.ubicacion,
                COALESCE(p.nombres || ' ' || p.apellidos, 'Sistema') AS responsable,
                t.evidencia
         FROM tracking_encomiendas t
         LEFT JOIN usuarios u ON u.id_usuario = t.id_usuario
         LEFT JOIN personas p ON p.id_persona = u.id_persona
         JOIN encomiendas e ON e.id_encomienda = t.id_encomienda
         JOIN viajes v ON v.id_viaje = e.id_viaje
         WHERE ($1::integer IS NULL OR v.id_agencia = $1)
           AND ($2::integer IS NULL OR v.id_conductor = $2)
         ORDER BY t.id_encomienda, t.fecha_hora`,
        [agencyId, driverId],
      ),
      executor.query<PickupRow>(
        `SELECT s.id_solicitud,
                p.nro_documento AS dni,
                p.nombres, p.apellidos,
                s.telefono_contacto,
                s.fecha_solicitada::text,
                s.direccion, s.descripcion, s.estado,
                COALESCE(pa.nombres || ' ' || pa.apellidos, '') AS asignado
         FROM solicitudes_recojo s
         JOIN personas p ON p.id_persona = s.id_persona
         LEFT JOIN usuarios ua ON ua.id_usuario = s.id_usuario_asignado
         LEFT JOIN personas pa ON pa.id_persona = ua.id_persona
         WHERE ($1::integer IS NULL OR s.id_agencia = $1)
           AND ($2::integer IS NULL OR s.id_usuario_asignado = $2)
         ORDER BY s.fecha_solicitada, s.id_solicitud`,
        [agencyId, user.rol === "CONDUCTOR" ? userId : null],
      ),
    ]);

  const histories = new Map<number, TrackingHistorico[]>();
  for (const row of tracking.rows) {
    const current = histories.get(row.id_encomienda) || [];
    current.push({
      estado: STATUS_FROM_DB[row.estado] || "registrado",
      fecha: row.fecha_hora,
      ubicacion: row.ubicacion,
      responsable: row.responsable,
      evidencia:
        row.evidencia && typeof row.evidencia === "object"
          ? row.evidencia
          : null,
    });
    histories.set(row.id_encomienda, current);
  }

  return {
    rutas: routes.rows.map(mapRoute),
    vehiculos: vehicles.rows.map(mapVehicle),
    conductores: drivers.rows.map(mapDriver),
    viajes: trips.rows.map(mapTrip),
    boletos: tickets.rows.map(mapTicket),
    encomiendas: parcels.rows.map((row) =>
      mapParcel(row, histories.get(row.id_encomienda) || []),
    ),
    recojos: pickups.rows.map(mapPickup),
  };
}

export async function getDatabaseSnapshot(
  user: SessionUser,
): Promise<DatabaseState> {
  return readSnapshot({ query }, user);
}

function requireRole(user: SessionUser, roles: readonly SessionUser["rol"][]) {
  if (user.rol !== "SUPER_ADMIN" && !roles.includes(user.rol)) {
    throw forbidden();
  }
}

function requireUserId(user: SessionUser): number {
  const userId = parseEntityId(user.id, "U");
  if (!userId) throw forbidden("La sesión no tiene un usuario válido.");
  return userId;
}

async function upsertPerson(
  executor: QueryExecutor,
  input: {
    dni: string;
    names: string;
    surnames: string;
    phone: string;
    type: "CLIENTE" | "EMPLEADO";
  },
): Promise<number> {
  const result = await executor.query<NumericIdRow>(
    `INSERT INTO personas (
       tipo_documento, nro_documento, nombres, apellidos, telefono, tipo
     )
     VALUES ('DNI', $1, $2, $3, $4, $5)
     ON CONFLICT (nro_documento) DO UPDATE
     SET nombres = EXCLUDED.nombres,
         apellidos = EXCLUDED.apellidos,
         telefono = EXCLUDED.telefono,
         updated_at = NOW()
     RETURNING id_persona AS id`,
    [input.dni, input.names, input.surnames, input.phone, input.type],
  );
  return result.rows[0].id;
}

function splitName(value: string): { names: string; surnames: string } {
  const parts = value.trim().split(/\s+/);
  const names = parts.shift() || value;
  return { names, surnames: parts.join(" ") || names };
}

function toPeruTimestamp(date: string, time: string): string {
  return `${date}T${time}:00-05:00`;
}

function idempotentId(
  result: { rows: NumericIdRow[] },
): number | null {
  return result.rows[0]?.id || null;
}

async function getTicketById(
  executor: QueryExecutor,
  ticketId: number,
): Promise<Boleto | null> {
  const result = await executor.query<TicketRow>(
    `SELECT b.id_boleto, b.codigo, b.id_viaje, b.asiento,
            p.nro_documento AS pasajero_dni,
            p.nombres AS pasajero_nombres,
            p.apellidos AS pasajero_apellidos,
            COALESCE(p.telefono, '') AS pasajero_telefono,
            b.precio::text,
            TO_CHAR(b.fecha_emision AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS fecha_emision,
            b.estado, b.sunat_estado
     FROM boletos b
     JOIN personas p ON p.id_persona = b.id_persona_pasajero
     WHERE b.id_boleto = $1`,
    [ticketId],
  );
  return result.rows[0] ? mapTicket(result.rows[0]) : null;
}

export async function createTicket(
  user: SessionUser,
  input: TicketInput,
): Promise<Boleto> {
  requireRole(user, OPERATOR_ROLES);
  const userId = requireUserId(user);
  const activeAgencyId = requireAgencyId(user);
  const scopeAgencyId = agencyScopeId(user);
  const tripId = parseEntityId(input.id_viaje, "T");
  if (!tripId) throw notFound("El viaje seleccionado no existe.");

  const ticket = await withTransaction(async (client) => {
    const existing = await client.query<NumericIdRow>(
      `SELECT ticket.id_boleto AS id
       FROM boletos ticket
       JOIN viajes trip ON trip.id_viaje = ticket.id_viaje
       WHERE ticket.request_id = $1
         AND ($2::integer IS NULL OR trip.id_agencia = $2)`,
      [input.requestId, scopeAgencyId],
    );
    const existingId = idempotentId(existing);
    if (existingId) {
      const current = await getTicketById(client, existingId);
      if (current) return current;
    }

    const trip = await client.query<{
       id_viaje: number;
       estado: string;
       capacidad: number;
       id_agencia: number;
     }>(
       `SELECT v.id_viaje, v.estado, veh.capacidad, v.id_agencia
        FROM viajes v
        JOIN vehiculos veh ON veh.id_vehiculo = v.id_vehiculo
        WHERE v.id_viaje = $1
          AND ($2::integer IS NULL OR v.id_agencia = $2)
        FOR UPDATE`,
      [tripId, scopeAgencyId],
    );
    const tripRow = trip.rows[0];
    if (!tripRow || tripRow.estado === "CANCELADO") {
      throw conflict("TRIP_NOT_AVAILABLE", "El viaje no está disponible.");
    }
    if (input.asiento > tripRow.capacidad) {
      throw conflict(
        "SEAT_OUT_OF_RANGE",
        `El asiento debe estar entre 1 y ${tripRow.capacidad}.`,
      );
    }

    const personId = await upsertPerson(client, {
      dni: input.pasajeroDni,
      names: input.pasajeroNombres,
      surnames: input.pasajeroApellidos,
      phone: input.pasajeroTelefono,
      type: "CLIENTE",
    });
    const idResult = await client.query<NumericIdRow>(
      "SELECT nextval(pg_get_serial_sequence('boletos', 'id_boleto'))::int AS id",
    );
    const ticketId = idResult.rows[0].id;
    const code = `B001-${String(ticketId).padStart(8, "0")}`;

    try {
      await client.query(
         `INSERT INTO boletos (
           id_boleto, codigo, id_viaje, id_persona_pasajero, asiento,
           precio, estado, sunat_estado, request_id, id_agencia_venta
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', 'PENDIENTE', $7, $8)`,
        [
          ticketId,
          code,
          tripId,
          personId,
          input.asiento,
          input.precio,
          input.requestId,
          tripRow.id_agencia,
        ],
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw conflict("SEAT_ALREADY_BOOKED", "El asiento ya está ocupado.");
      }
      throw error;
    }

    const created = await getTicketById(client, ticketId);
    if (!created) throw new Error("TICKET_CREATE_FAILED");
    await writeAuditLog({
      userId,
      agencyId: tripRow.id_agencia || activeAgencyId,
      action: "TICKET_CREATED",
      entity: "boleto",
      entityId: created.id,
      metadata: { tripId: input.id_viaje, seat: input.asiento },
    }, client);
    return created;
  });

  return ticket;
}

export async function cancelTicket(
  user: SessionUser,
  ticketIdValue: string,
): Promise<void> {
  requireRole(user, OPERATOR_ROLES);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const ticketId = parseEntityId(ticketIdValue, "B");
  if (!ticketId) throw notFound();

  await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE boletos ticket
       SET estado = 'ANULADO', anulado_por = $1, anulado_at = NOW()
       FROM viajes trip
       WHERE ticket.id_boleto = $2
         AND ticket.estado = 'ACTIVO'
         AND trip.id_viaje = ticket.id_viaje
         AND ($3::integer IS NULL OR trip.id_agencia = $3)
       RETURNING ticket.id_boleto, trip.id_agencia`,
      [userId, ticketId, scopeAgencyId],
    );
    if (!result.rowCount) throw notFound("El boleto no existe o ya fue anulado.");
    await writeAuditLog({
      userId,
      agencyId:
        (result.rows[0] as { id_agencia?: number } | undefined)?.id_agencia ||
        null,
      action: "TICKET_CANCELLED",
      entity: "boleto",
      entityId: ticketIdValue,
    }, client);
  });
}

async function getParcelById(
  executor: QueryExecutor,
  parcelId: number,
): Promise<Encomienda | null> {
  const [parcel, tracking] = await Promise.all([
    executor.query<ParcelRow>(
      `SELECT e.id_encomienda, e.codigo_tracking, e.id_viaje,
              sr.nro_documento AS remitente_dni,
              sr.nombres AS remitente_nombres,
              sr.apellidos AS remitente_apellidos,
              COALESCE(sr.telefono, '') AS remitente_telefono,
              sd.nro_documento AS destinatario_dni,
              sd.nombres AS destinatario_nombres,
              sd.apellidos AS destinatario_apellidos,
              COALESCE(sd.telefono, '') AS destinatario_telefono,
              e.peso_kg::text, e.valor_declarado::text, e.costo::text,
              e.descripcion, e.estado,
              TO_CHAR(e.fecha_registro AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha_registro
       FROM encomiendas e
       JOIN personas sr ON sr.id_persona = e.id_persona_remitente
       JOIN personas sd ON sd.id_persona = e.id_persona_destinatario
       WHERE e.id_encomienda = $1`,
      [parcelId],
    ),
    executor.query<TrackingRow>(
      `SELECT t.id_encomienda, t.estado,
              TO_CHAR(t.fecha_hora AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS fecha_hora,
              t.ubicacion,
              COALESCE(p.nombres || ' ' || p.apellidos, 'Sistema') AS responsable,
              t.evidencia
       FROM tracking_encomiendas t
       LEFT JOIN usuarios u ON u.id_usuario = t.id_usuario
       LEFT JOIN personas p ON p.id_persona = u.id_persona
       WHERE t.id_encomienda = $1
       ORDER BY t.fecha_hora`,
      [parcelId],
    ),
  ]);

  if (!parcel.rows[0]) return null;
  return mapParcel(
    parcel.rows[0],
    tracking.rows.map((row) => ({
      estado: STATUS_FROM_DB[row.estado] || "registrado",
      fecha: row.fecha_hora,
      ubicacion: row.ubicacion,
      responsable: row.responsable,
      evidencia:
        row.evidencia && typeof row.evidencia === "object"
          ? row.evidencia
          : null,
    })),
  );
}

export async function createParcel(
  user: SessionUser,
  input: ParcelInput,
): Promise<Encomienda> {
  requireRole(user, OPERATOR_ROLES);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const tripId = parseEntityId(input.id_viaje, "T");
  if (!tripId) throw notFound("El viaje seleccionado no existe.");

  return withTransaction(async (client) => {
    const existing = await client.query<NumericIdRow>(
      `SELECT parcel.id_encomienda AS id
       FROM encomiendas parcel
       JOIN viajes trip ON trip.id_viaje = parcel.id_viaje
       WHERE parcel.request_id = $1
         AND ($2::integer IS NULL OR trip.id_agencia = $2)`,
      [input.requestId, scopeAgencyId],
    );
    const existingId = idempotentId(existing);
    if (existingId) {
      const current = await getParcelById(client, existingId);
      if (current) return current;
    }

    const trip = await client.query<{ estado: string; id_agencia: number }>(
      `SELECT estado, id_agencia
       FROM viajes
       WHERE id_viaje = $1
         AND ($2::integer IS NULL OR id_agencia = $2)
       FOR SHARE`,
      [tripId, scopeAgencyId],
    );
    if (!trip.rows[0] || trip.rows[0].estado === "CANCELADO") {
      throw conflict("TRIP_NOT_AVAILABLE", "El viaje no está disponible.");
    }

    const sender = splitName(input.remitenteNombre);
    const recipient = splitName(input.destinatarioNombre);
    const senderId = await upsertPerson(client, {
      dni: input.remitenteDni,
      names: sender.names,
      surnames: sender.surnames,
      phone: input.remitenteTelefono,
      type: "CLIENTE",
    });
    const recipientId = await upsertPerson(client, {
      dni: input.destinatarioDni,
      names: recipient.names,
      surnames: recipient.surnames,
      phone: input.destinatarioTelefono,
      type: "CLIENTE",
    });
    const idResult = await client.query<NumericIdRow>(
      "SELECT nextval(pg_get_serial_sequence('encomiendas', 'id_encomienda'))::int AS id",
    );
    const parcelId = idResult.rows[0].id;
    const today = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const trackingCode = `ECV-${today}-${String(parcelId).padStart(5, "0")}`;

    await client.query(
       `INSERT INTO encomiendas (
          id_encomienda, codigo_tracking, id_viaje,
          id_persona_remitente, id_persona_destinatario,
          peso_kg, valor_declarado, costo, descripcion, request_id,
          id_agencia_registro
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        parcelId,
        trackingCode,
        tripId,
        senderId,
        recipientId,
        input.peso,
        input.valor,
        input.costo,
        input.descripcion,
        input.requestId,
        trip.rows[0].id_agencia,
      ],
    );
    await client.query(
      `INSERT INTO tracking_encomiendas (
         id_encomienda, estado, ubicacion, id_usuario, request_id
       )
       VALUES ($1, 'REGISTRADO', 'Oficina Ayacucho', $2, $3)`,
      [parcelId, userId, input.requestId],
    );

    const created = await getParcelById(client, parcelId);
    if (!created) throw new Error("PARCEL_CREATE_FAILED");
    await writeAuditLog({
      userId,
      agencyId: trip.rows[0].id_agencia,
      action: "PARCEL_CREATED",
      entity: "encomienda",
      entityId: created.id,
      metadata: { tripId: input.id_viaje, trackingCode },
    }, client);
    return created;
  });
}

export async function createTrip(
  user: SessionUser,
  input: TripInput,
): Promise<Viaje> {
  requireRole(user, OPERATOR_ROLES);
  const userId = requireUserId(user);
  const activeAgencyId = requireAgencyId(user);
  const routeId = parseEntityId(input.id_ruta, "R");
  const vehicleId = parseEntityId(input.id_vehiculo, "V");
  const driverId = parseEntityId(input.id_conductor, "C");
  if (!routeId || !vehicleId || !driverId) throw notFound("Datos de viaje inválidos.");
  const departure = new Date(toPeruTimestamp(input.fecha, input.hora));
  if (departure.getTime() < Date.now() - 5 * 60 * 1000) {
    throw conflict("TRIP_IN_THE_PAST", "La salida debe ser futura.");
  }

  return withTransaction(async (client) => {
    const existing = await client.query<NumericIdRow>(
      `SELECT id_viaje AS id
       FROM viajes
       WHERE request_id = $1
         AND id_agencia = $2`,
      [input.requestId, activeAgencyId],
    );
    const existingId = idempotentId(existing);
    if (existingId) {
      const current = await getTripById(client, existingId);
      if (current) return current;
    }

    const checks = await client.query<{
      route_duration: string | null;
      route_active: boolean;
      vehicle_active: boolean;
      driver_active: boolean;
      license_valid: boolean;
    }>(
      `SELECT
          (SELECT duracion_horas::text
           FROM rutas
           WHERE id_ruta = $1
             AND id_agencia_origen = $5
             AND estado = 'ACTIVO') AS route_duration,
         EXISTS (
           SELECT 1 FROM rutas
           WHERE id_ruta = $1
             AND id_agencia_origen = $5
             AND estado = 'ACTIVO'
         ) AS route_active,
         EXISTS (
           SELECT 1 FROM vehiculos
           WHERE id_vehiculo = $2
             AND id_agencia_base = $5
             AND estado = 'ACTIVO'
         ) AS vehicle_active,
         EXISTS (
           SELECT 1 FROM conductores
           WHERE id_conductor = $3
             AND id_agencia_base = $5
             AND habilitado = TRUE
         ) AS driver_active,
         EXISTS (
           SELECT 1 FROM conductores
           WHERE id_conductor = $3
             AND id_agencia_base = $5
             AND fecha_vencimiento >= $4::date
          ) AS license_valid`,
      [routeId, vehicleId, driverId, input.fecha, activeAgencyId],
    );
    const check = checks.rows[0];
    if (!check?.route_active || !check.vehicle_active || !check.driver_active) {
      throw conflict("TRIP_RESOURCES_UNAVAILABLE", "La ruta, vehículo o conductor no está disponible.");
    }
    if (!check.license_valid) {
      throw conflict("DRIVER_LICENSE_EXPIRED", "La licencia del conductor no está vigente.");
    }

    if (!check.route_duration) {
      throw conflict("ROUTE_NOT_AVAILABLE", "La ruta no está disponible.");
    }

    const overlapping = await client.query(
      `SELECT 1
       FROM viajes existing
       JOIN rutas existing_route ON existing_route.id_ruta = existing.id_ruta
       WHERE existing.estado IN ('PROGRAMADO', 'EN_CURSO')
         AND (
           existing.id_vehiculo = $1
           OR existing.id_conductor = $2
         )
         AND tstzrange(
           existing.fecha_hora_salida,
           COALESCE(
             existing.fecha_hora_llegada,
             existing.fecha_hora_salida
               + existing_route.duracion_horas * INTERVAL '1 hour'
           ),
           '[)'
         ) && tstzrange(
           $3::timestamptz,
           $3::timestamptz + $4::numeric * INTERVAL '1 hour',
           '[)'
         )
       LIMIT 1`,
      [
        vehicleId,
        driverId,
        toPeruTimestamp(input.fecha, input.hora),
        check.route_duration,
      ],
    );
    if (overlapping.rowCount) {
      throw conflict(
        "TRIP_RESOURCE_OVERLAP",
        "El vehículo o conductor ya está ocupado en ese horario.",
      );
    }

    const idResult = await client.query<NumericIdRow>(
      "SELECT nextval(pg_get_serial_sequence('viajes', 'id_viaje'))::int AS id",
    );
    const tripId = idResult.rows[0].id;
    await client.query(
       `INSERT INTO viajes (
          id_viaje, id_ruta, id_vehiculo, id_conductor,
          fecha_hora_salida, precio_final, request_id, id_agencia
        )
        VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)`,
      [
        tripId,
        routeId,
        vehicleId,
        driverId,
        toPeruTimestamp(input.fecha, input.hora),
        input.precio,
        input.requestId,
        activeAgencyId,
      ],
    );

    const created = await getTripById(client, tripId);
    if (!created) throw new Error("TRIP_CREATE_FAILED");
    await writeAuditLog({
      userId,
      agencyId: activeAgencyId,
      action: "TRIP_CREATED",
      entity: "viaje",
      entityId: created.id,
      metadata: { routeId: input.id_ruta, vehicleId: input.id_vehiculo },
    }, client);
    return created;
  });
}

async function getTripById(
  executor: QueryExecutor,
  tripId: number,
): Promise<Viaje | null> {
  const result = await executor.query<TripRow>(
    `SELECT v.id_viaje, v.id_ruta, v.id_vehiculo, v.id_conductor,
            TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
            TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
            v.estado, v.precio_final::text
     FROM viajes v
     WHERE v.id_viaje = $1`,
    [tripId],
  );
  return result.rows[0] ? mapTrip(result.rows[0]) : null;
}

export async function updateTripStatus(
  user: SessionUser,
  tripValue: string,
  input: TripStatusInput,
): Promise<Viaje> {
  requireRole(user, DRIVER_ROLES);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const tripId = parseEntityId(tripValue, "T");
  if (!tripId) throw notFound("El viaje no existe.");

  return withTransaction(async (client) => {
    const trip = await client.query<{
       id_viaje: number;
       id_conductor: number;
       id_agencia: number;
       estado: string;
     }>(
       `SELECT id_viaje, id_conductor, id_agencia, estado
        FROM viajes
        WHERE id_viaje = $1
          AND ($2::integer IS NULL OR id_agencia = $2)
        FOR UPDATE`,
      [tripId, scopeAgencyId],
    );
    const current = trip.rows[0];
    if (!current) throw notFound("El viaje no existe.");

    if (user.rol === "CONDUCTOR") {
      const driverId = await getConductorId(userId);
      if (!driverId || driverId !== current.id_conductor) {
        throw forbidden("Solo puedes actualizar tus propios viajes.");
      }
    }

    const expectedState =
      input.newState === "en_curso" ? "PROGRAMADO" : "EN_CURSO";
    if (current.estado !== expectedState) {
      throw conflict(
        "INVALID_TRIP_TRANSITION",
        input.newState === "en_curso"
          ? "Solo se puede iniciar un viaje programado."
          : "Solo se puede finalizar un viaje en curso.",
      );
    }

    const dbState = input.newState === "en_curso" ? "EN_CURSO" : "COMPLETADO";
    await client.query(
      `UPDATE viajes
       SET estado = $1,
           fecha_hora_llegada = CASE
             WHEN $1 = 'COMPLETADO' THEN COALESCE(fecha_hora_llegada, NOW())
             ELSE fecha_hora_llegada
           END,
           updated_at = NOW()
       WHERE id_viaje = $2`,
      [dbState, tripId],
    );

    const updated = await getTripById(client, tripId);
    if (!updated) throw new Error("TRIP_STATUS_UPDATE_FAILED");
    await writeAuditLog(
      {
        userId,
        agencyId: current.id_agencia,
        action:
          input.newState === "en_curso"
            ? "TRIP_STARTED"
            : "TRIP_COMPLETED",
        entity: "viaje",
        entityId: tripValue,
        metadata: { from: current.estado, to: dbState },
      },
      client,
    );
    return updated;
  });
}

export async function cancelTrip(
  user: SessionUser,
  tripValue: string,
): Promise<void> {
  requireRole(user, OPERATOR_ROLES);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const tripId = parseEntityId(tripValue, "T");
  if (!tripId) throw notFound("El viaje no existe.");

  await withTransaction(async (client) => {
    const trip = await client.query<{ estado: string; id_agencia: number }>(
      `SELECT estado, id_agencia
       FROM viajes
       WHERE id_viaje = $1
         AND ($2::integer IS NULL OR id_agencia = $2)
       FOR UPDATE`,
      [tripId, scopeAgencyId],
    );
    if (!trip.rows[0]) throw notFound("El viaje no existe.");
    if (trip.rows[0].estado === "CANCELADO") return;
    if (trip.rows[0].estado !== "PROGRAMADO") {
      throw conflict(
        "TRIP_NOT_CANCELLABLE",
        "Solo se pueden cancelar viajes programados.",
      );
    }

    const activeParcels = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM encomiendas
       WHERE id_viaje = $1 AND estado <> 'ENTREGADO'`,
      [tripId],
    );
    if (Number(activeParcels.rows[0]?.count || 0) > 0) {
      throw conflict(
        "TRIP_HAS_ACTIVE_PARCELS",
        "No se puede cancelar un viaje con encomiendas pendientes.",
      );
    }

    await client.query(
      "UPDATE viajes SET estado = 'CANCELADO', updated_at = NOW() WHERE id_viaje = $1",
      [tripId],
    );
    await client.query(
      `UPDATE boletos
       SET estado = 'ANULADO', anulado_por = $1, anulado_at = NOW()
       WHERE id_viaje = $2 AND estado = 'ACTIVO'`,
      [userId, tripId],
    );
    await writeAuditLog({
      userId,
      agencyId: trip.rows[0].id_agencia,
      action: "TRIP_CANCELLED",
      entity: "viaje",
      entityId: tripValue,
    }, client);
  });
}

export async function updateParcelStatus(
  user: SessionUser,
  parcelValue: string,
  input: ParcelStatusInput,
): Promise<Encomienda> {
  requireRole(user, DRIVER_ROLES);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const parcelId = parseEntityId(parcelValue, "E");
  if (!parcelId) throw notFound("La encomienda no existe.");

  return withTransaction(async (client) => {
    const idempotent = await client.query<{ id_encomienda: number }>(
      `SELECT tracking.id_encomienda
       FROM tracking_encomiendas tracking
       JOIN encomiendas parcel
         ON parcel.id_encomienda = tracking.id_encomienda
       JOIN viajes trip ON trip.id_viaje = parcel.id_viaje
       WHERE tracking.request_id = $1
         AND ($2::integer IS NULL OR trip.id_agencia = $2)`,
      [input.requestId, scopeAgencyId],
    );
    const existingParcelId = idempotent.rows[0]?.id_encomienda;
    if (existingParcelId) {
      const current = await getParcelById(client, existingParcelId);
      if (current) return current;
    }

    const parcel = await client.query<{
      estado: string;
      id_conductor: number;
      id_agencia: number;
    }>(
      `SELECT e.estado, v.id_conductor, v.id_agencia
       FROM encomiendas e
       JOIN viajes v ON v.id_viaje = e.id_viaje
       WHERE e.id_encomienda = $1
         AND ($2::integer IS NULL OR v.id_agencia = $2)
       FOR UPDATE`,
      [parcelId, scopeAgencyId],
    );
    const current = parcel.rows[0];
    if (!current) throw notFound("La encomienda no existe.");

    if (user.rol === "CONDUCTOR") {
      const driverId = await getConductorId(userId);
      if (!driverId || driverId !== current.id_conductor) {
        throw forbidden("Solo puedes actualizar encomiendas de tus viajes.");
      }
    }

    const currentState = STATUS_FROM_DB[current.estado] || "registrado";
    if (!canAdvanceParcelStatus(currentState, input.newState)) {
      throw conflict(
        "INVALID_STATUS_TRANSITION",
        `No se puede pasar de ${currentState} a ${input.newState}.`,
      );
    }

    const location = input.location || DEFAULT_LOCATIONS[input.newState];
    const evidence = input.evidence || null;
    await client.query(
      "UPDATE encomiendas SET estado = $1, updated_at = NOW() WHERE id_encomienda = $2",
      [STATUS_TO_DB[input.newState], parcelId],
    );
    await client.query(
      `INSERT INTO tracking_encomiendas (
         id_encomienda, estado, ubicacion, latitude, longitude,
         id_usuario, observacion, evidencia, request_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        parcelId,
        STATUS_TO_DB[input.newState],
        location,
        input.latitude ?? null,
        input.longitude ?? null,
        userId,
        null,
        evidence ? JSON.stringify(evidence) : null,
        input.requestId,
      ],
    );
    await writeAuditLog({
      userId,
      agencyId: current.id_agencia,
      action: "PARCEL_STATUS_UPDATED",
      entity: "encomienda",
      entityId: parcelValue,
      metadata: { from: currentState, to: input.newState },
    }, client);

    const updated = await getParcelById(client, parcelId);
    if (!updated) throw new Error("PARCEL_UPDATE_FAILED");
    return updated;
  });
}

export async function createPickup(
  user: SessionUser,
  input: PickupInput,
): Promise<Recojo> {
  requireRole(user, OPERATOR_ROLES);
  const userId = requireUserId(user);
  const activeAgencyId = requireAgencyId(user);
  return withTransaction(async (client) => {
    const dateCheck = await client.query<{ valid: boolean }>(
      `SELECT $1::date >= (NOW() AT TIME ZONE 'America/Lima')::date AS valid`,
      [input.fecha],
    );
    if (!dateCheck.rows[0]?.valid) {
      throw conflict(
        "PICKUP_DATE_IN_PAST",
        "La fecha de recojo no puede estar en el pasado.",
      );
    }

    const existing = await client.query<NumericIdRow>(
      `SELECT id_solicitud AS id
       FROM solicitudes_recojo
       WHERE request_id = $1
         AND id_agencia = $2`,
      [input.requestId, activeAgencyId],
    );
    const existingId = idempotentId(existing);
    if (existingId) {
      const current = await getPickupById(client, existingId);
      if (current) return current;
    }

    const name = splitName(input.nombre);
    const personId = await upsertPerson(client, {
      dni: input.dni,
      names: name.names,
      surnames: name.surnames,
      phone: input.telefono,
      type: "CLIENTE",
    });
    const idResult = await client.query<NumericIdRow>(
      "SELECT nextval(pg_get_serial_sequence('solicitudes_recojo', 'id_solicitud'))::int AS id",
    );
    const pickupId = idResult.rows[0].id;
    await client.query(
       `INSERT INTO solicitudes_recojo (
          id_solicitud, id_persona, direccion, telefono_contacto,
          fecha_solicitada, descripcion, request_id, id_agencia
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        pickupId,
        personId,
        input.direccion,
        input.telefono,
        input.fecha,
        input.descripcion,
        input.requestId,
        activeAgencyId,
      ],
    );
    const created = await getPickupById(client, pickupId);
    if (!created) throw new Error("PICKUP_CREATE_FAILED");
    await writeAuditLog({
      userId,
      agencyId: activeAgencyId,
      action: "PICKUP_CREATED",
      entity: "solicitud_recojo",
      entityId: created.id,
    }, client);
    return created;
  });
}

async function getPickupById(
  executor: QueryExecutor,
  pickupId: number,
): Promise<Recojo | null> {
  const result = await executor.query<PickupRow>(
    `SELECT s.id_solicitud,
            p.nro_documento AS dni,
            p.nombres, p.apellidos,
            s.telefono_contacto,
            s.fecha_solicitada::text,
            s.direccion, s.descripcion, s.estado,
            COALESCE(pa.nombres || ' ' || pa.apellidos, '') AS asignado
     FROM solicitudes_recojo s
     JOIN personas p ON p.id_persona = s.id_persona
     LEFT JOIN usuarios ua ON ua.id_usuario = s.id_usuario_asignado
     LEFT JOIN personas pa ON pa.id_persona = ua.id_persona
     WHERE s.id_solicitud = $1`,
    [pickupId],
  );
  return result.rows[0] ? mapPickup(result.rows[0]) : null;
}

export async function updatePickupStatus(
  user: SessionUser,
  pickupValue: string,
  input: PickupStatusInput,
): Promise<Recojo> {
  requireRole(user, OPERATOR_ROLES);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const pickupId = parseEntityId(pickupValue, "P");
  if (!pickupId) throw notFound("La solicitud de recojo no existe.");

  return withTransaction(async (client) => {
    const current = await client.query<{ estado: string; id_agencia: number }>(
      `SELECT estado, id_agencia
       FROM solicitudes_recojo
       WHERE id_solicitud = $1
         AND ($2::integer IS NULL OR id_agencia = $2)
       FOR UPDATE`,
      [pickupId, scopeAgencyId],
    );
    if (!current.rows[0]) {
      throw notFound("La solicitud de recojo no existe.");
    }
    if (!["PENDIENTE", "ASIGNADO"].includes(current.rows[0].estado)) {
      throw conflict(
        "PICKUP_NOT_UPDATABLE",
        "La solicitud ya está cerrada.",
      );
    }

    const dbState = input.newState === "completado" ? "COMPLETADO" : "CANCELADO";
    await client.query(
      `UPDATE solicitudes_recojo
       SET estado = $1, updated_at = NOW()
       WHERE id_solicitud = $2`,
      [dbState, pickupId],
    );
    const updated = await getPickupById(client, pickupId);
    if (!updated) throw new Error("PICKUP_STATUS_UPDATE_FAILED");
    await writeAuditLog(
      {
        userId,
        agencyId: current.rows[0].id_agencia,
        action:
          input.newState === "completado"
            ? "PICKUP_COMPLETED"
            : "PICKUP_CANCELLED",
        entity: "solicitud_recojo",
        entityId: pickupValue,
        metadata: { from: current.rows[0].estado, to: dbState },
      },
      client,
    );
    return updated;
  });
}

export async function assignPickup(
  user: SessionUser,
  pickupValue: string,
  input: PickupAssignmentInput,
): Promise<Recojo> {
  requireRole(user, OPERATOR_ROLES);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const pickupId = parseEntityId(pickupValue, "P");
  const driverId = parseEntityId(input.driverId, "C");
  if (!pickupId || !driverId) throw notFound("La solicitud o el conductor no existe.");

  return withTransaction(async (client) => {
    const driver = await client.query<{ user_id: number; id_agencia: number }>(
      `SELECT u.id_usuario AS user_id, c.id_agencia_base AS id_agencia
       FROM conductores c
       JOIN usuarios u ON u.id_persona = c.id_persona
       WHERE c.id_conductor = $1 AND c.habilitado = TRUE AND u.estado = 'ACTIVO'`,
      [driverId],
    );
    if (!driver.rows[0]) throw conflict("DRIVER_NOT_AVAILABLE", "El conductor no está disponible.");

    const pickup = await client.query<{ estado: string; id_agencia: number }>(
      `SELECT estado, id_agencia
       FROM solicitudes_recojo
       WHERE id_solicitud = $1
         AND ($2::integer IS NULL OR id_agencia = $2)
       FOR UPDATE`,
      [pickupId, scopeAgencyId],
    );
    if (!pickup.rows[0]) throw notFound("La solicitud de recojo no existe.");
    if (pickup.rows[0].estado !== "PENDIENTE") {
      throw conflict(
        "PICKUP_NOT_ASSIGNABLE",
        "La solicitud ya no está pendiente de asignación.",
      );
    }
    if (driver.rows[0].id_agencia !== pickup.rows[0].id_agencia) {
      throw conflict(
        "DRIVER_AGENCY_MISMATCH",
        "El conductor pertenece a otra agencia.",
      );
    }

    const updated = await client.query(
      `UPDATE solicitudes_recojo
       SET estado = 'ASIGNADO', id_usuario_asignado = $1, updated_at = NOW()
       WHERE id_solicitud = $2
       RETURNING id_solicitud`,
      [driver.rows[0].user_id, pickupId],
    );
    if (!updated.rowCount) throw notFound("La solicitud de recojo no existe.");
    const result = await getPickupById(client, pickupId);
    if (!result) throw new Error("PICKUP_ASSIGN_FAILED");
    await writeAuditLog({
      userId,
      agencyId: pickup.rows[0].id_agencia,
      action: "PICKUP_ASSIGNED",
      entity: "solicitud_recojo",
      entityId: pickupValue,
      metadata: { driverId: input.driverId },
    }, client);
    return result;
  });
}

export async function findPublicTracking(
  trackingCode: string,
  recipientDniLast4: string,
): Promise<PublicTrackingResult | null> {
  const result = await query<{
    codigo_tracking: string;
    estado: string;
    fecha_registro: string;
    ultima_ubicacion: string | null;
    ultima_actualizacion: string | null;
  }>(
    `SELECT
       e.codigo_tracking,
       e.estado,
       TO_CHAR(e.fecha_registro AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha_registro,
       latest.ubicacion AS ultima_ubicacion,
       TO_CHAR(latest.fecha_hora AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS ultima_actualizacion
     FROM encomiendas e
     JOIN personas recipient ON recipient.id_persona = e.id_persona_destinatario
     LEFT JOIN LATERAL (
       SELECT t.ubicacion, t.fecha_hora
       FROM tracking_encomiendas t
       WHERE t.id_encomienda = e.id_encomienda
       ORDER BY t.fecha_hora DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE e.codigo_tracking = $1
       AND RIGHT(recipient.nro_documento, 4) = $2
     LIMIT 1`,
    [trackingCode, recipientDniLast4],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    codigo_tracking: row.codigo_tracking,
    estado: STATUS_FROM_DB[row.estado] || "registrado",
    fechaRegistro: row.fecha_registro,
    ultimaUbicacion: row.ultima_ubicacion || "Sin actualización",
    ultimaActualizacion: row.ultima_actualizacion || row.fecha_registro,
  };
}

export async function getVehicleLocations(
  user: SessionUser,
): Promise<VehicleLocation[]> {
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const driverId =
    user.rol === "CONDUCTOR" ? await getConductorId(userId) : null;
  if (user.rol === "CONDUCTOR" && !driverId) {
    throw forbidden("Tu usuario no está vinculado a un conductor habilitado.");
  }

  const result = await query<VehicleLocationRow>(
    `SELECT
       c.id_conductor,
       p.nombres || ' ' || p.apellidos AS conductor_name,
       assignment.origen || ' → ' || assignment.destino AS route_label,
       assignment.placa,
       location.latitude::text,
       location.longitude::text,
       location.accuracy_m::text,
       location.speed_kmh::text,
       location.heading::text,
       FLOOR(EXTRACT(EPOCH FROM location.updated_at) * 1000)::bigint::text
         AS timestamp_ms,
       location.is_active
     FROM ubicaciones_vehiculos location
     JOIN conductores c ON c.id_conductor = location.id_conductor
     JOIN personas p ON p.id_persona = c.id_persona
     LEFT JOIN LATERAL (
       SELECT r.origen, r.destino, vehicle.placa
       FROM viajes trip
       JOIN rutas r ON r.id_ruta = trip.id_ruta
       JOIN vehiculos vehicle ON vehicle.id_vehiculo = trip.id_vehiculo
       WHERE trip.id_conductor = c.id_conductor
         AND trip.estado IN ('PROGRAMADO', 'EN_CURSO')
       ORDER BY
         CASE WHEN trip.estado = 'EN_CURSO' THEN 0 ELSE 1 END,
         ABS(EXTRACT(EPOCH FROM (trip.fecha_hora_salida - NOW())))
       LIMIT 1
     ) assignment ON TRUE
     WHERE location.updated_at >= NOW() - INTERVAL '5 minutes'
       AND ($1::integer IS NULL OR c.id_agencia_base = $1)
       AND ($2::integer IS NULL OR c.id_conductor = $2)
     ORDER BY location.updated_at DESC`,
    [scopeAgencyId, driverId],
  );

  return result.rows.map((row) => ({
    conductorId: formatEntityId("C", row.id_conductor, 2),
    conductorName: row.conductor_name,
    routeLabel: row.route_label || "Sin ruta asignada",
    placa: row.placa || "---",
    lat: asNumber(row.latitude),
    lng: asNumber(row.longitude),
    accuracy: asNumber(row.accuracy_m),
    speed: row.speed_kmh === null ? null : asNumber(row.speed_kmh),
    heading: row.heading === null ? null : asNumber(row.heading),
    timestamp: asNumber(row.timestamp_ms),
    isActive: row.is_active,
  }));
}

export async function updateVehicleLocation(
  user: SessionUser,
  input: VehicleLocationUpdateInput,
): Promise<void> {
  requireRole(user, DRIVER_ROLES);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const sessionDriverId =
    user.rol === "CONDUCTOR" ? await getConductorId(userId) : null;
  const requestedDriverId = input.conductorId
    ? parseEntityId(input.conductorId, "C")
    : null;

  if (user.rol === "CONDUCTOR" && !sessionDriverId) {
    throw forbidden("Tu usuario no está vinculado a un conductor habilitado.");
  }
  if (
    user.rol === "CONDUCTOR" &&
    requestedDriverId &&
    requestedDriverId !== sessionDriverId
  ) {
    throw forbidden("No puedes transmitir la ubicación de otro conductor.");
  }

  const driverId = sessionDriverId || requestedDriverId;
  if (!driverId) {
    throw conflict(
      "DRIVER_REQUIRED",
      "Selecciona un conductor válido para transmitir la ubicación.",
    );
  }

  await withTransaction(async (client) => {
    const driver = await client.query<{
      id_conductor: number;
      id_agencia: number;
    }>(
      `SELECT id_conductor, id_agencia_base AS id_agencia
       FROM conductores
       WHERE id_conductor = $1
         AND habilitado = TRUE
         AND ($2::integer IS NULL OR id_agencia_base = $2)
       FOR SHARE`,
      [driverId, scopeAgencyId],
    );
    if (!driver.rows[0]) {
      throw conflict(
        "DRIVER_NOT_AVAILABLE",
        "El conductor no está disponible.",
      );
    }

    const previous = await client.query<{ is_active: boolean }>(
      `SELECT is_active
       FROM ubicaciones_vehiculos
       WHERE id_conductor = $1
       FOR UPDATE`,
      [driverId],
    );
    const wasActive = previous.rows[0]?.is_active ?? false;

    if (!input.isActive) {
      await client.query(
        `UPDATE ubicaciones_vehiculos
         SET is_active = FALSE, updated_by = $2, updated_at = NOW()
         WHERE id_conductor = $1`,
        [driverId, userId],
      );
    } else {
      await client.query(
        `INSERT INTO ubicaciones_vehiculos (
           id_conductor, latitude, longitude, accuracy_m,
           speed_kmh, heading, is_active, updated_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
         ON CONFLICT (id_conductor) DO UPDATE
         SET latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             accuracy_m = EXCLUDED.accuracy_m,
             speed_kmh = EXCLUDED.speed_kmh,
             heading = EXCLUDED.heading,
             is_active = TRUE,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
        [
          driverId,
          input.latitude,
          input.longitude,
          input.accuracy,
          input.speed,
          input.heading,
          userId,
        ],
      );
    }

    if (wasActive !== input.isActive) {
      await writeAuditLog(
        {
          userId,
          agencyId: driver.rows[0].id_agencia,
          action: input.isActive
            ? "GPS_TRACKING_STARTED"
            : "GPS_TRACKING_STOPPED",
          entity: "conductor",
          entityId: formatEntityId("C", driverId, 2),
        },
        client,
      );
    }
  });
}

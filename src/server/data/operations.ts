import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import {
  PERMISSIONS,
  roleHasPermission,
  type Permission,
} from "@/lib/auth/permissions";
import {
  type Boleto,
  type Conductor,
  type DatabaseState,
  EMPTY_DATABASE_STATE,
  type Encomienda,
  type IncidenciaViaje,
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
import type { PaymentMethod } from "@/lib/domain/payments";
import { calculateParcelPrice } from "@/lib/domain/parcel-pricing";
import type { TicketHistoryResult } from "@/lib/domain/ticket-sales";
import { createTrackingCode } from "@/lib/domain/tracking";
import type {
  CancellationInput,
  DriverProfileUpdateInput,
  ParcelInput,
  ParcelStatusInput,
  PickupAssignmentInput,
  PickupInput,
  PickupStatusInput,
  TicketInput,
  TicketHistoryQuery,
  TripIncidentInput,
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
  fecha_llegada: string | null;
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
  metodo_pago: PaymentMethod;
  referencia_pago: string;
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
  dimensiones: string;
  valor_declarado: string;
  costo: string;
  metodo_pago: PaymentMethod;
  referencia_pago: string;
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
  age_seconds: number;
  is_active: boolean;
}

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
  EN_RUTA: "en_curso",
  COMPLETADO: "completado",
  CANCELADO: "cancelado",
};

const PICKUP_STATUS_FROM_DB: Record<string, Recojo["estado"]> = {
  PENDIENTE: "pendiente",
  ASIGNADO: "asignado",
  EN_CAMINO: "en_camino",
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
    estado: TRIP_STATUS_FROM_DB[row.estado?.toUpperCase()] || "programado",
    precio: asNumber(row.precio_final),
    fechaLlegada: row.fecha_llegada,
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
    metodoPago: row.metodo_pago,
    referenciaPago: row.referencia_pago,
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
    dimensiones: row.dimensiones,
    valor: asNumber(row.valor_declarado),
    costo: asNumber(row.costo),
    metodoPago: row.metodo_pago,
    referenciaPago: row.referencia_pago,
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
     WHERE c.id_usuario = $1
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

export async function listTicketHistory(
  user: SessionUser,
  filters: TicketHistoryQuery,
): Promise<TicketHistoryResult> {
  requirePermission(user, PERMISSIONS.TICKET_SELL);
  const agencyId = agencyScopeId(user);
  const pageSize = 20;
  const values = [agencyId, filters.search, filters.from, filters.to, filters.state.toUpperCase()];
  const fromSql = `FROM boletos b
    JOIN personas p ON p.id_persona = b.id_persona_pasajero
    JOIN viajes v ON v.id_viaje = b.id_viaje
    JOIN rutas r ON r.id_ruta = v.id_ruta
    WHERE ($1::integer IS NULL OR v.id_agencia = $1)
      AND ($2::text = '' OR STRPOS(LOWER(CONCAT_WS(' ', b.codigo,
        p.nro_documento, p.nombres, p.apellidos, r.origen, r.destino)), LOWER($2)) > 0)
      AND ($3::text = '' OR b.fecha_emision >=
        (NULLIF($3, '')::date::timestamp AT TIME ZONE 'America/Lima'))
      AND ($4::text = '' OR b.fecha_emision <
        ((NULLIF($4, '')::date + 1)::timestamp AT TIME ZONE 'America/Lima'))
      AND ($5::text = '' OR b.estado = $5)`;
  const count = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total ${fromSql}`, values,
  );
  const total = Number(count.rows[0]?.total || 0);
  const page = Math.min(filters.page, Math.max(1, Math.ceil(total / pageSize)));
  const result = await query<TicketRow & { ruta: string; salida: string }>(
    `SELECT b.id_boleto, b.codigo, b.id_viaje, b.asiento,
      p.nro_documento AS pasajero_dni, p.nombres AS pasajero_nombres,
      p.apellidos AS pasajero_apellidos, COALESCE(p.telefono, '') AS pasajero_telefono,
      b.precio::text, b.metodo_pago, COALESCE(b.referencia_pago, '') AS referencia_pago,
      TO_CHAR(b.fecha_emision AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS fecha_emision,
      b.estado, b.sunat_estado, CONCAT(r.origen, ' → ', r.destino) AS ruta,
      TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS salida
    ${fromSql}
    ORDER BY b.fecha_emision DESC, b.id_boleto DESC
    LIMIT $6 OFFSET $7`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return {
    items: result.rows.map((row) => ({ ...mapTicket(row), ruta: row.ruta, salida: row.salida })),
    total, page, pageSize,
  };
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

  // A scheduled departure that has already passed can no longer be started or
  // cancelled. Close it automatically so its vehicle and driver are released
  // the next time the dashboard is opened.
  try {
    await executor.query(
      `UPDATE viajes
       SET estado = 'CANCELADO'
       WHERE estado = 'PROGRAMADO'
         AND fecha <= CURRENT_DATE
         AND ($1::integer IS NULL OR id_conductor = $1)`,
      [driverId],
    );
  } catch {
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
      ).catch(() => ({ rows: [] })),
      executor.query<VehicleRow>(
        `SELECT id_vehiculo, placa, tipo, marca, modelo, capacidad, estado
         FROM vehiculos
         ORDER BY placa`,
        [],
      ).catch(() => ({ rows: [] })),
      executor.query<DriverRow>(
        `SELECT c.id_conductor,
                COALESCE(p.nombres, '') AS nombres,
                COALESCE(p.apellidos, '') AS apellidos,
                COALESCE(c.licencia, '') AS nro_licencia,
                COALESCE(c.categoria, '') AS categoria_licencia,
                c.fecha_vencimiento::text
         FROM conductores c
         LEFT JOIN usuarios u ON u.id_usuario = c.id_usuario
         LEFT JOIN personas p ON p.id_persona = u.id_persona
         ORDER BY p.apellidos, p.nombres`,
        [],
      ).catch(() => ({ rows: [] })),
      executor.query<TripRow>(
        `SELECT v.id_viaje,
                COALESCE(r.id_ruta, 1) AS id_ruta,
                v.id_vehiculo,
                v.id_conductor,
                v.fecha::text AS fecha,
                COALESCE(v.hora_salida::text, '08:00') AS hora,
                v.estado,
                COALESCE(r.precio_base::text, '0') AS precio_final,
                COALESCE(v.hora_llegada::text, '') AS fecha_llegada
         FROM viajes v
         LEFT JOIN rutas r ON r.origen = v.origen AND r.destino = v.destino
         WHERE ($1::integer IS NULL OR v.id_conductor = $1)
         ORDER BY v.fecha DESC, v.hora_salida DESC`,
        [driverId],
      ).catch(() => ({ rows: [] })),
      executor.query<TicketRow>(
        `SELECT b.id_boleto, b.codigo, b.id_viaje, b.asiento,
                p.nro_documento AS pasajero_dni,
                p.nombres AS pasajero_nombres,
                p.apellidos AS pasajero_apellidos,
                COALESCE(p.telefono, '') AS pasajero_telefono,
                b.precio::text,
                'EFECTIVO' AS metodo_pago,
                '' AS referencia_pago,
                TO_CHAR(b.fecha_emision AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS fecha_emision,
                b.estado, b.sunat_estado
         FROM boletos b
         JOIN personas p ON p.id_persona = b.id_persona_pasajero
         LEFT JOIN viajes v ON v.id_viaje = b.id_viaje
         WHERE ($1::integer IS NULL OR v.id_conductor = $1)
         ORDER BY b.fecha_emision DESC`,
        [driverId],
      ).catch(() => ({ rows: [] })),
      executor.query<ParcelRow>(
        `SELECT e.id_encomienda,
                e.codigo AS codigo_tracking,
                e.id_viaje,
                '' AS remitente_dni,
                e.remitente AS remitente_nombres,
                '' AS remitente_apellidos,
                '' AS remitente_telefono,
                '' AS destinatario_dni,
                e.destinatario AS destinatario_nombres,
                '' AS destinatario_apellidos,
                '' AS destinatario_telefono,
                e.cantidad::text AS peso_kg,
                '' AS dimensiones,
                '0' AS valor_declarado,
                '0' AS costo,
                'EFECTIVO' AS metodo_pago,
                '' AS referencia_pago,
                e.descripcion,
                e.estado,
                '' AS fecha_registro
         FROM encomiendas e
         LEFT JOIN viajes v ON v.id_viaje = e.id_viaje
         WHERE ($1::integer IS NULL OR v.id_conductor = $1)
         ORDER BY e.id_encomienda DESC`,
        [driverId],
      ).catch(() => ({ rows: [] })),
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
         ORDER BY t.id_encomienda, t.fecha_hora`,
        [],
      ).catch(() => ({ rows: [] })),
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
         WHERE ($1::integer IS NULL OR s.id_usuario_asignado = $1)
         ORDER BY s.fecha_solicitada, s.id_solicitud`,
        [user.rol === "CONDUCTOR" ? userId : null],
      ).catch(() => ({ rows: [] })),
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

function requirePermission(user: SessionUser, permission: Permission) {
  if (!roleHasPermission(user.rol, permission)) {
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
            b.precio::text, b.metodo_pago,
            COALESCE(b.referencia_pago, '') AS referencia_pago,
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
  requirePermission(user, PERMISSIONS.TICKET_SELL);
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
       precio_final: string;
       id_agencia: number;
       departure_future: boolean;
     }>(
       `SELECT v.id_viaje, v.estado, veh.capacidad, v.id_agencia,
               v.fecha_hora_salida > clock_timestamp() AS departure_future,
               v.precio_final::text
        FROM viajes v
        JOIN vehiculos veh ON veh.id_vehiculo = v.id_vehiculo
        WHERE v.id_viaje = $1
          AND ($2::integer IS NULL OR v.id_agencia = $2)
        FOR UPDATE`,
      [tripId, scopeAgencyId],
    );
    const tripRow = trip.rows[0];
    if (!tripRow || tripRow.estado !== "PROGRAMADO" || !tripRow.departure_future) {
      throw conflict(
        "TRIP_NOT_AVAILABLE",
        "El viaje ya inició, su hora de salida pasó o no está disponible. Selecciona otra salida.",
      );
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
           precio, metodo_pago, referencia_pago, estado, sunat_estado,
           request_id, id_agencia_venta
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''),
           'ACTIVO', 'PENDIENTE', $9, $10
         )`,
        [
          ticketId,
          code,
          tripId,
          personId,
          input.asiento,
          asNumber(tripRow.precio_final),
          input.metodoPago,
          input.referenciaPago || "",
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
      metadata: {
        tripId: input.id_viaje,
        seat: input.asiento,
        paymentMethod: input.metodoPago,
      },
    }, client);
    return created;
  });

  return ticket;
}

export async function cancelTicket(
  user: SessionUser,
  ticketIdValue: string,
  input: CancellationInput,
): Promise<void> {
  requirePermission(user, PERMISSIONS.TICKET_CANCEL_APPROVE);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const ticketId = parseEntityId(ticketIdValue, "B");
  if (!ticketId) throw notFound();

  await withTransaction(async (client) => {
    const current = await client.query<{
      estado: string;
      trip_estado: string;
      fecha_hora_salida: string;
      id_agencia: number;
    }>(
      `SELECT ticket.estado, trip.estado AS trip_estado,
              trip.fecha_hora_salida::text, trip.id_agencia
       FROM boletos ticket
       JOIN viajes trip ON trip.id_viaje = ticket.id_viaje
       WHERE ticket.id_boleto = $1
         AND ($2::integer IS NULL OR trip.id_agencia = $2)
       FOR UPDATE OF ticket, trip`,
      [ticketId, scopeAgencyId],
    );
    const ticket = current.rows[0];
    if (!ticket) throw notFound("El boleto no existe.");
    if (ticket.estado !== "ACTIVO") {
      throw conflict("TICKET_ALREADY_CANCELLED", "El boleto ya fue anulado.");
    }
    if (
      ticket.trip_estado !== "PROGRAMADO" ||
      new Date(ticket.fecha_hora_salida).getTime() <= Date.now()
    ) {
      throw conflict(
        "TICKET_NOT_CANCELLABLE",
        "Solo se puede anular un boleto antes de la salida del viaje.",
      );
    }
    await client.query(
      `UPDATE boletos
       SET estado = 'ANULADO', anulado_por = $1, anulado_at = NOW(),
           motivo_anulacion = $2, nota_credito_estado = 'PENDIENTE'
       WHERE id_boleto = $3`,
      [userId, input.reason, ticketId],
    );
    await writeAuditLog({
      userId,
      agencyId: ticket.id_agencia,
      action: "TICKET_CANCELLED",
      entity: "boleto",
      entityId: ticketIdValue,
      metadata: { reason: input.reason },
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
              e.peso_kg::text, COALESCE(e.dimensiones, '') AS dimensiones,
              e.valor_declarado::text, e.costo::text, e.metodo_pago,
              COALESCE(e.referencia_pago, '') AS referencia_pago,
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
  requirePermission(user, PERMISSIONS.PARCEL_CREATE);
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

    const trip = await client.query<{
      estado: string;
      id_agencia: number;
      agency_name: string;
      distance_km: string;
      departure_future: boolean;
    }>(
      `SELECT trip.estado, trip.id_agencia, agency.nombre AS agency_name,
              trip.fecha_hora_salida > clock_timestamp() AS departure_future,
              route.distancia_km::text AS distance_km
       FROM viajes trip
       JOIN agencias agency ON agency.id_agencia = trip.id_agencia
       JOIN rutas route ON route.id_ruta = trip.id_ruta
       WHERE trip.id_viaje = $1
         AND ($2::integer IS NULL OR trip.id_agencia = $2)
       FOR SHARE`,
      [tripId, scopeAgencyId],
    );
    if (!trip.rows[0] || trip.rows[0].estado !== "PROGRAMADO" || !trip.rows[0].departure_future) {
      throw conflict(
        "TRIP_NOT_AVAILABLE",
        "El viaje ya inició, su hora de salida pasó o no está disponible. Selecciona otra salida.",
      );
    }

    const priceQuote = calculateParcelPrice({
      distanceKm: Number(trip.rows[0].distance_km),
      actualWeightKg: input.peso,
      dimensions: input.dimensiones,
      declaredValue: input.valor,
    });
    if (!priceQuote) {
      throw conflict(
        "PARCEL_PRICE_UNAVAILABLE",
        "No se pudo calcular la tarifa con los datos proporcionados.",
      );
    }
    if (Math.abs(input.costo - priceQuote.total) > 0.009) {
      throw conflict(
        "PARCEL_PRICE_CHANGED",
        `La tarifa vigente es S/ ${priceQuote.total.toFixed(2)}. Revisa el cálculo antes de cobrar.`,
      );
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
    const trackingCode = createTrackingCode(parcelId);

    await client.query(
       `INSERT INTO encomiendas (
          id_encomienda, codigo_tracking, id_viaje,
          id_persona_remitente, id_persona_destinatario,
          peso_kg, dimensiones, valor_declarado, costo, metodo_pago,
          referencia_pago, descripcion, request_id, id_agencia_registro
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, ''),
          $12, $13, $14
        )`,
      [
        parcelId,
        trackingCode,
        tripId,
        senderId,
        recipientId,
        input.peso,
        input.dimensiones,
        input.valor,
        priceQuote.total,
        input.metodoPago,
        input.referenciaPago || "",
        input.descripcion,
        input.requestId,
        trip.rows[0].id_agencia,
      ],
    );
    await client.query(
      `INSERT INTO tracking_encomiendas (
         id_encomienda, estado, ubicacion, id_usuario, request_id
       )
       VALUES ($1, 'REGISTRADO', $2, $3, $4)`,
      [
        parcelId,
        trip.rows[0].agency_name,
        userId,
        input.requestId,
      ],
    );

    const created = await getParcelById(client, parcelId);
    if (!created) throw new Error("PARCEL_CREATE_FAILED");
    await writeAuditLog({
      userId,
      agencyId: trip.rows[0].id_agencia,
      action: "PARCEL_CREATED",
      entity: "encomienda",
      entityId: created.id,
      metadata: {
        tripId: input.id_viaje,
        trackingCode,
        paymentMethod: input.metodoPago,
        priceQuote,
      },
    }, client);
    return created;
  });
}

export async function createTrip(
  user: SessionUser,
  input: TripInput,
): Promise<Viaje> {
  requirePermission(user, PERMISSIONS.TRIP_MANAGE);
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

    // Serialize scheduling decisions per vehicle and driver so two concurrent
    // requests cannot both pass the overlap check.
    await client.query(
      "SELECT pg_advisory_xact_lock(7801, $1), pg_advisory_xact_lock(7802, $2)",
      [vehicleId, driverId],
    );

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

    const compliance = await client.query<{
      identity_state: "PENDIENTE" | "VERIFICADA" | "OBSERVADA";
      missing_driver_documents: string[];
      missing_vehicle_documents: string[];
    }>(
      `SELECT driver.identidad_estado AS identity_state,
              ARRAY(
                SELECT required.type
                FROM unnest(ARRAY['DNI', 'LICENCIA']::varchar[]) AS required(type)
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM documentos_operativos document
                  WHERE document.titular_tipo = 'CONDUCTOR'
                    AND document.id_conductor = driver.id_conductor
                    AND document.tipo_documento = required.type
                    AND document.estado IN ('VIGENTE', 'POR_VENCER')
                    AND document.fecha_vencimiento >= $3::date
                    AND document.revisado_por IS NOT NULL
                    AND (required.type <> 'DNI' OR document.numero = person.nro_documento)
                    AND (required.type <> 'LICENCIA' OR document.numero = driver.nro_licencia)
                )
              ) AS missing_driver_documents,
              ARRAY(
                SELECT required.type
                FROM unnest(ARRAY['SOAT', 'CITV', 'TUC']::varchar[]) AS required(type)
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM documentos_operativos document
                  WHERE document.titular_tipo = 'VEHICULO'
                    AND document.id_vehiculo = $2
                    AND document.tipo_documento = required.type
                    AND document.estado IN ('VIGENTE', 'POR_VENCER')
                    AND document.fecha_vencimiento >= $3::date
                    AND document.revisado_por IS NOT NULL
                )
              ) AS missing_vehicle_documents
       FROM conductores driver
       JOIN personas person ON person.id_persona = driver.id_persona
       WHERE driver.id_conductor = $1`,
      [driverId, vehicleId, input.fecha],
    );
    const complianceRow = compliance.rows[0];
    const complianceProblems: string[] = [];
    if (complianceRow?.identity_state !== "VERIFICADA") {
      complianceProblems.push("la identidad del conductor no está verificada");
    }
    if (complianceRow?.missing_driver_documents.length) {
      complianceProblems.push(
        `faltan documentos aprobados del conductor: ${complianceRow.missing_driver_documents.join(", ")}`,
      );
    }
    if (complianceRow?.missing_vehicle_documents.length) {
      complianceProblems.push(
        `faltan documentos aprobados del vehículo: ${complianceRow.missing_vehicle_documents.join(", ")}`,
      );
    }
    if (complianceProblems.length > 0) {
      throw conflict(
        "TRIP_DOCUMENT_COMPLIANCE_REQUIRED",
        `No se puede programar el viaje porque ${complianceProblems.join("; ")}.`,
      );
    }
    if (!check.license_valid) {
      throw conflict("DRIVER_LICENSE_EXPIRED", "La licencia del conductor no está vigente.");
    }

    if (!check.route_duration) {
      throw conflict("ROUTE_NOT_AVAILABLE", "La ruta no está disponible.");
    }

    const overlapping = await client.query<{
      id_viaje: number;
      requires_completion: boolean;
    }>(
      `SELECT existing.id_viaje,
              (existing.estado = 'EN_CURSO' OR existing.fecha_hora_salida <= NOW())
                AS requires_completion
       FROM viajes existing
       JOIN rutas existing_route ON existing_route.id_ruta = existing.id_ruta
       WHERE existing.estado IN ('PROGRAMADO', 'EN_CURSO')
         AND (
           existing.id_vehiculo = $1
           OR existing.id_conductor = $2
         )
         AND (
           existing.estado = 'EN_CURSO'
           OR existing.fecha_hora_salida <= NOW()
           OR tstzrange(
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
         )
       ORDER BY requires_completion DESC, existing.fecha_hora_salida
       LIMIT 1`,
      [
        vehicleId,
        driverId,
        toPeruTimestamp(input.fecha, input.hora),
        check.route_duration,
      ],
    );
    if (overlapping.rowCount) {
      const resourceConflict = overlapping.rows[0];
      throw conflict(
        "TRIP_RESOURCE_OVERLAP",
        resourceConflict.requires_completion
          ? `El vehículo o conductor sigue asignado al viaje T${String(resourceConflict.id_viaje).padStart(3, "0")}. Finaliza ese viaje antes de volver a asignarlo, o cancélalo si aún no salió.`
          : "El vehículo o conductor ya está ocupado en ese horario.",
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
            v.estado, v.precio_final::text,
            TO_CHAR(v.fecha_hora_llegada AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI') AS fecha_llegada
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
  requirePermission(user, PERMISSIONS.TRIP_STATUS_MANAGE);
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
       is_ready: boolean;
     }>(
       `SELECT id_viaje, id_conductor, id_agencia, estado,
               (fecha_hora_salida AT TIME ZONE 'America/Lima')::date <=
                 (NOW() AT TIME ZONE 'America/Lima')::date AS is_ready
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

    const isStarting = input.newState === "en_curso";
    const validCurrent = isStarting
      ? ["PROGRAMADO", "EN_CURSO", "EN_RUTA"].includes(current.estado)
      : ["EN_CURSO", "EN_RUTA"].includes(current.estado);
    if (!validCurrent) {
      throw conflict(
        "INVALID_TRIP_TRANSITION",
        isStarting
          ? "Solo se puede iniciar un viaje programado."
          : "Solo se puede finalizar un viaje en curso.",
      );
    }

    const dbState = input.newState === "en_curso" ? "EN_CURSO" : "COMPLETADO";
    await client.query(
      `UPDATE viajes
       SET estado = $1::varchar,
           fecha_hora_llegada = CASE
             WHEN $1::varchar = 'COMPLETADO' THEN COALESCE(fecha_hora_llegada, NOW())
             ELSE fecha_hora_llegada
           END,
           updated_at = NOW()
       WHERE id_viaje = $2`,
      [dbState, tripId],
    );

    if (input.newState === "completado") {
      // La llegada del vehículo también mueve los envíos que viajaban en él.
      // No se marcan como ENTREGADOS: eso requiere la entrega al destinatario.
      const parcelsInTransit = await client.query<{
        id_encomienda: number;
        codigo_tracking: string;
      }>(
        `SELECT id_encomienda, codigo_tracking
         FROM encomiendas
         WHERE id_viaje = $1 AND estado = 'EN_TRANSITO'
         FOR UPDATE`,
        [tripId],
      );

      for (const parcel of parcelsInTransit.rows) {
        await client.query(
          `UPDATE encomiendas
           SET estado = 'EN_DESTINO', updated_at = NOW()
           WHERE id_encomienda = $1 AND estado = 'EN_TRANSITO'`,
          [parcel.id_encomienda],
        );
        await client.query(
          `INSERT INTO tracking_encomiendas (
             id_encomienda, estado, ubicacion, id_usuario, fecha_hora,
             observacion, request_id
           )
           VALUES ($1, 'EN_DESTINO', 'Agencia de destino', $2, NOW(), $3, $4)`,
          [
            parcel.id_encomienda,
            userId,
            `Llegada registrada por el conductor del viaje ${tripValue}.`,
            randomUUID(),
          ],
        );
        await writeAuditLog(
          {
            userId,
            agencyId: current.id_agencia,
            action: "PARCEL_STATUS_UPDATED",
            entity: "encomienda",
            entityId: formatEntityId("E", parcel.id_encomienda, 3),
            metadata: {
              from: "en_transito",
              to: "en_destino",
              tripId: tripValue,
              trackingCode: parcel.codigo_tracking,
              source: "trip_arrival",
            },
          },
          client,
        );
      }
    }

    if (input.newState === "completado") {
      await client.query(
        `UPDATE ubicaciones_vehiculos
         SET is_active = FALSE,
             updated_by = $3,
             updated_at = NOW()
         WHERE id_conductor = $1
           AND id_viaje = $2
           AND is_active = TRUE`,
        [current.id_conductor, tripId, userId],
      );
    }

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
  input: CancellationInput,
): Promise<void> {
  requirePermission(user, PERMISSIONS.TRIP_MANAGE);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const tripId = parseEntityId(tripValue, "T");
  if (!tripId) throw notFound("El viaje no existe.");

  await withTransaction(async (client) => {
    const trip = await client.query<{
      estado: string;
      id_agencia: number;
      fecha_hora_salida: string;
    }>(
      `SELECT estado, id_agencia, fecha_hora_salida::text
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
    if (new Date(trip.rows[0].fecha_hora_salida).getTime() <= Date.now()) {
      throw conflict(
        "TRIP_NOT_CANCELLABLE",
        "No se puede cancelar un viaje cuya hora de salida ya pasó.",
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
      `UPDATE viajes
       SET estado = 'CANCELADO', motivo_cancelacion = $1, updated_at = NOW()
       WHERE id_viaje = $2`,
      [input.reason, tripId],
    );
    await client.query(
      `UPDATE boletos
       SET estado = 'ANULADO', anulado_por = $1, anulado_at = NOW(),
           motivo_anulacion = $3, nota_credito_estado = 'PENDIENTE'
       WHERE id_viaje = $2 AND estado = 'ACTIVO'`,
      [userId, tripId, `Cancelación de viaje: ${input.reason}`],
    );
    await writeAuditLog({
      userId,
      agencyId: trip.rows[0].id_agencia,
      action: "TRIP_CANCELLED",
      entity: "viaje",
      entityId: tripValue,
      metadata: { reason: input.reason },
    }, client);
  });
}

export async function updateParcelStatus(
  user: SessionUser,
  parcelValue: string,
  input: ParcelStatusInput,
): Promise<Encomienda> {
  requirePermission(user, PERMISSIONS.PARCEL_STATUS_MANAGE);
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
      trip_estado: string;
      is_today: boolean;
    }>(
      `SELECT e.estado, v.id_conductor, v.id_agencia,
              v.estado AS trip_estado,
              (v.fecha_hora_salida AT TIME ZONE 'America/Lima')::date =
                (NOW() AT TIME ZONE 'America/Lima')::date AS is_today
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
      if (!current.is_today || current.trip_estado !== "EN_CURSO") {
        throw forbidden("Solo puedes operar encomiendas de tu viaje en curso de hoy.");
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
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
    if (occurredAt) {
      const ageMs = Date.now() - occurredAt.getTime();
      if (ageMs < -5 * 60 * 1000 || ageMs > 7 * 24 * 60 * 60 * 1000) {
        throw conflict(
          "INVALID_EVENT_TIME",
          "La fecha del evento sin conexión está fuera del rango permitido.",
        );
      }
    }

    await client.query(
      `INSERT INTO tracking_encomiendas (
         id_encomienda, estado, ubicacion, latitude, longitude,
         id_usuario, fecha_hora, observacion, evidencia, request_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()),
               $8, $9::jsonb, $10)`,
      [
        parcelId,
        STATUS_TO_DB[input.newState],
        location,
        input.latitude ?? null,
        input.longitude ?? null,
        userId,
        occurredAt?.toISOString() ?? null,
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
  requirePermission(user, PERMISSIONS.PICKUP_CREATE);
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
  requirePermission(user, PERMISSIONS.PICKUP_STATUS_MANAGE);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const pickupId = parseEntityId(pickupValue, "P");
  if (!pickupId) throw notFound("La solicitud de recojo no existe.");

  return withTransaction(async (client) => {
    const current = await client.query<{
      estado: string;
      id_agencia: number;
      id_usuario_asignado: number | null;
    }>(
      `SELECT estado, id_agencia, id_usuario_asignado
       FROM solicitudes_recojo
       WHERE id_solicitud = $1
         AND ($2::integer IS NULL OR id_agencia = $2)
       FOR UPDATE`,
      [pickupId, scopeAgencyId],
    );
    if (!current.rows[0]) {
      throw notFound("La solicitud de recojo no existe.");
    }
    if (
      user.rol === "CONDUCTOR" &&
      current.rows[0].id_usuario_asignado !== userId
    ) {
      throw forbidden("Solo puedes actualizar recojos que te fueron asignados.");
    }
    if (!["PENDIENTE", "ASIGNADO", "EN_CAMINO"].includes(current.rows[0].estado)) {
      throw conflict(
        "PICKUP_NOT_UPDATABLE",
        "La solicitud ya está cerrada.",
      );
    }

    const allowed =
      (current.rows[0].estado === "ASIGNADO" && input.newState === "en_camino") ||
      (current.rows[0].estado === "EN_CAMINO" && input.newState === "completado") ||
      input.newState === "cancelado";
    if (!allowed) {
      throw conflict(
        "INVALID_PICKUP_TRANSITION",
        "La transición de estado del recojo no está permitida.",
      );
    }
    const dbState = {
      en_camino: "EN_CAMINO",
      completado: "COMPLETADO",
      cancelado: "CANCELADO",
    }[input.newState];
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
        action: `PICKUP_${dbState}`,
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
  requirePermission(user, PERMISSIONS.PICKUP_ASSIGN);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const pickupId = parseEntityId(pickupValue, "P");
  const driverId = parseEntityId(input.driverId, "C");
  if (!pickupId || !driverId) throw notFound("La solicitud o el conductor no existe.");

  return withTransaction(async (client) => {
    const driver = await client.query<{ user_id: number; id_agencia: number | null }>(
      `SELECT c.id_usuario AS user_id, NULL::integer AS id_agencia
       FROM conductores c
       WHERE c.id_conductor = $1`,
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
  const history = await query<{
    estado: string;
    fecha: string;
    ubicacion: string;
  }>(
    `SELECT tracking.estado,
            TO_CHAR(
              tracking.fecha_hora AT TIME ZONE 'America/Lima',
              'YYYY-MM-DD HH24:MI'
            ) AS fecha,
            tracking.ubicacion
     FROM tracking_encomiendas tracking
     JOIN encomiendas parcel
       ON parcel.id_encomienda = tracking.id_encomienda
     JOIN personas recipient
       ON recipient.id_persona = parcel.id_persona_destinatario
     WHERE parcel.codigo_tracking = $1
       AND RIGHT(recipient.nro_documento, 4) = $2
     ORDER BY tracking.fecha_hora, tracking.id_tracking`,
    [trackingCode, recipientDniLast4],
  );
  return {
    codigo_tracking: row.codigo_tracking,
    estado: STATUS_FROM_DB[row.estado] || "registrado",
    fechaRegistro: row.fecha_registro,
    ultimaUbicacion: row.ultima_ubicacion || "Sin actualización",
    ultimaActualizacion: row.ultima_actualizacion || row.fecha_registro,
    historial: history.rows.map((event) => ({
      estado: STATUS_FROM_DB[event.estado] || "registrado",
      fecha: event.fecha,
      ubicacion: event.ubicacion,
    })),
  };
}

export async function getVehicleLocations(
  user: SessionUser,
): Promise<VehicleLocation[]> {
  const userId = requireUserId(user);
  const driverId =
    user.rol === "CONDUCTOR" ? await getConductorId(userId) : null;
  if (user.rol === "CONDUCTOR" && !driverId) {
    throw forbidden("Tu usuario no está vinculado a un conductor habilitado.");
  }

  const result = await query<VehicleLocationRow>(
    `SELECT
       c.id_conductor,
       COALESCE(p.nombres || ' ' || p.apellidos, 'Conductor ' || c.id_conductor) AS conductor_name,
       COALESCE(trip_info.origen || ' → ' || trip_info.destino, 'En servicio') AS route_label,
       COALESCE(veh.placa, '---') AS placa,
       location.latitude::text,
       location.longitude::text,
       location.accuracy_m::text,
       location.speed_kmh::text,
       location.heading::text,
       FLOOR(EXTRACT(EPOCH FROM location.updated_at) * 1000)::bigint::text AS timestamp_ms,
       GREATEST(
         0,
         FLOOR(EXTRACT(EPOCH FROM (NOW() - location.updated_at)))
       )::integer AS age_seconds,
       location.is_active
     FROM ubicaciones_vehiculos location
     JOIN conductores c ON c.id_conductor = location.id_conductor
     LEFT JOIN usuarios u ON u.id_usuario = c.id_usuario
     LEFT JOIN personas p ON p.id_persona = u.id_persona
     LEFT JOIN LATERAL (
       SELECT v.origen, v.destino, v.id_vehiculo
       FROM viajes v
       WHERE v.id_conductor = c.id_conductor
         AND v.estado IN ('EN_CURSO', 'EN_RUTA', 'PROGRAMADO')
       ORDER BY CASE WHEN v.estado IN ('EN_CURSO', 'EN_RUTA') THEN 0 ELSE 1 END
       LIMIT 1
     ) trip_info ON TRUE
     LEFT JOIN vehiculos veh ON veh.id_vehiculo = trip_info.id_vehiculo
     WHERE location.is_active = TRUE
       AND ($1::integer IS NULL OR location.id_conductor = $1)
     ORDER BY location.updated_at DESC`,
    [driverId],
  );

  return result.rows.map((row) => ({
    conductorId: formatEntityId("C", row.id_conductor, 2),
    conductorName: row.conductor_name,
    routeLabel: row.route_label || "En servicio",
    placa: row.placa || "---",
    lat: asNumber(row.latitude),
    lng: asNumber(row.longitude),
    accuracy: asNumber(row.accuracy_m),
    speed: row.speed_kmh === null ? null : asNumber(row.speed_kmh),
    heading: row.heading === null ? null : asNumber(row.heading),
    timestamp: asNumber(row.timestamp_ms),
    ageSeconds: row.age_seconds,
    isActive: row.is_active,
  }));
}

export async function updateVehicleLocation(
  user: SessionUser,
  input: VehicleLocationUpdateInput,
): Promise<void> {
  requirePermission(user, PERMISSIONS.GPS_PUBLISH);
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
    if (!input.isActive) {
      await client.query(
        `UPDATE ubicaciones_vehiculos
         SET is_active = FALSE, updated_by = $2, updated_at = NOW()
         WHERE id_conductor = $1`,
        [driverId, userId],
      );
      return;
    }

    await client.query(
      `INSERT INTO ubicaciones_vehiculos (
         id_conductor, latitude, longitude, accuracy_m, speed_kmh, heading, is_active, updated_by, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, NOW())
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
  });
}

export async function getTripDetail(
  user: SessionUser,
  tripValue: string,
): Promise<{
  trip: {
    id: string;
    code: string;
    origin: string;
    destination: string;
    date: string;
    departureTime: string;
    vehicleId: string;
    vehiclePlate: string;
    driverId: string;
    status: string;
    passengerCount: number;
    parcelCount: number;
  };
  passengers: Array<{
    id: number;
    codigo: string;
    asiento: number;
    estado: string;
    nombre: string;
    documento: string;
    telefono: string | null;
  }>;
  parcels: Array<{
    id: number;
    codigo: string;
    descripcion: string;
    estado: string;
    remitente: string;
    destinatario: string;
  }>;
}> {
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const tripId = parseEntityId(tripValue, "T");
  if (!tripId) throw notFound("El viaje no existe.");

  const sessionDriverId =
    user.rol === "CONDUCTOR" ? await getConductorId(userId) : null;
  if (user.rol === "CONDUCTOR" && !sessionDriverId) {
    throw forbidden("Tu usuario no está vinculado a un conductor habilitado.");
  }

  const tripRes = await query<{
    id_viaje: number;
    origen: string;
    destino: string;
    fecha: string;
    hora: string;
    estado: string;
    placa: string;
    marca: string;
    modelo: string;
    id_vehiculo: number;
    id_conductor: number;
    id_agencia: number;
  }>(
    `SELECT
       v.id_viaje,
       r.origen,
       r.destino,
       TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS fecha,
       TO_CHAR(v.fecha_hora_salida AT TIME ZONE 'America/Lima', 'HH24:MI') AS hora,
       v.estado,
       veh.placa,
       veh.marca,
       veh.modelo,
       v.id_vehiculo,
       v.id_conductor,
       v.id_agencia
     FROM viajes v
     JOIN rutas r ON r.id_ruta = v.id_ruta
     JOIN vehiculos veh ON veh.id_vehiculo = v.id_vehiculo
     WHERE v.id_viaje = $1
       AND ($2::integer IS NULL OR v.id_agencia = $2)
       AND ($3::integer IS NULL OR v.id_conductor = $3)
     LIMIT 1`,
    [tripId, scopeAgencyId, sessionDriverId],
  );

  const trip = tripRes.rows[0];
  if (!trip) {
    throw notFound("El viaje no existe o no tienes autorización para consultarlo.");
  }

  const [passengers, parcels] = await Promise.all([
    query<{
      id_boleto: number;
      codigo: string;
      asiento: number;
      estado: string;
      nombres: string;
      apellidos: string;
      nro_documento: string;
      telefono: string | null;
    }>(
      `SELECT
         b.id_boleto,
         b.codigo,
         b.asiento,
         b.estado,
         p.nombres,
         p.apellidos,
         p.nro_documento,
         p.telefono
       FROM boletos b
       JOIN personas p ON p.id_persona = b.id_persona_pasajero
       WHERE b.id_viaje = $1
         AND b.estado = 'ACTIVO'
       ORDER BY b.asiento`,
      [trip.id_viaje],
    ),
    query<{
      id_encomienda: number;
      codigo_tracking: string;
      descripcion: string;
      estado: string;
      remitente: string;
      destinatario: string;
    }>(
      `SELECT
         e.id_encomienda,
         e.codigo_tracking,
         e.descripcion,
         e.estado,
         sr.nombres || ' ' || sr.apellidos AS remitente,
         sd.nombres || ' ' || sd.apellidos AS destinatario
       FROM encomiendas e
       JOIN personas sr ON sr.id_persona = e.id_persona_remitente
       JOIN personas sd ON sd.id_persona = e.id_persona_destinatario
       WHERE e.id_viaje = $1
       ORDER BY e.fecha_registro`,
      [trip.id_viaje],
    ),
  ]);

  return {
    trip: {
      id: formatEntityId("T", trip.id_viaje, 3),
      code: formatEntityId("T", trip.id_viaje, 3),
      origin: trip.origen,
      destination: trip.destino,
      date: trip.fecha,
      departureTime: trip.hora,
      vehicleId: String(trip.id_vehiculo),
      vehiclePlate: trip.placa,
      driverId: String(trip.id_conductor),
      status: trip.estado,
      passengerCount: passengers.rows.length,
      parcelCount: parcels.rows.length,
    },
    passengers: passengers.rows.map((row) => ({
      id: row.id_boleto,
      codigo: row.codigo,
      asiento: row.asiento,
      estado: row.estado,
      nombre: `${row.nombres} ${row.apellidos}`.trim(),
      documento: row.nro_documento,
      telefono: row.telefono,
    })),
    parcels: parcels.rows.map((row) => ({
      id: row.id_encomienda,
      codigo: row.codigo_tracking,
      descripcion: row.descripcion,
      estado: row.estado,
      remitente: row.remitente,
      destinatario: row.destinatario,
    })),
  };
}

export async function createTripIncident(
  user: SessionUser,
  tripValue: string,
  input: TripIncidentInput,
): Promise<IncidenciaViaje> {
  requirePermission(user, PERMISSIONS.INCIDENT_CREATE);
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const tripId = parseEntityId(tripValue, "T");
  if (!tripId) throw notFound("El viaje no existe.");

  const sessionDriverId =
    user.rol === "CONDUCTOR" ? await getConductorId(userId) : null;
  if (user.rol === "CONDUCTOR" && !sessionDriverId) {
    throw forbidden("Tu usuario no está vinculado a un conductor habilitado.");
  }

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
         AND ($3::integer IS NULL OR id_conductor = $3)
       FOR SHARE`,
      [tripId, scopeAgencyId, sessionDriverId],
    );

    const tripRow = trip.rows[0];
    if (!tripRow) {
      throw notFound("El viaje no existe o no tienes autorización sobre él.");
    }

    if (tripRow.estado === "CANCELADO") {
      throw conflict(
        "TRIP_CANCELLED",
        "No se pueden reportar incidencias en viajes cancelados.",
      );
    }

    const insertResult = await client.query<{
      id_incidencia: number;
      id_viaje: number;
      id_conductor: number;
      id_agencia: number;
      tipo: IncidenciaViaje["tipo"];
      descripcion: string;
      nivel_gravedad: IncidenciaViaje["nivel_gravedad"];
      latitude: string | null;
      longitude: string | null;
      created_at: string;
    }>(
      `INSERT INTO incidencias_viajes (
         id_viaje, id_conductor, id_agencia, id_usuario,
         tipo, descripcion, nivel_gravedad, latitude, longitude
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING
         id_incidencia, id_viaje, id_conductor, id_agencia,
         tipo, descripcion, nivel_gravedad,
         latitude::text, longitude::text,
         TO_CHAR(created_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI:SS') AS created_at`,
      [
        tripId,
        tripRow.id_conductor,
        tripRow.id_agencia,
        userId,
        input.tipo,
        input.descripcion,
        input.nivel_gravedad,
        input.latitude ?? null,
        input.longitude ?? null,
      ],
    );

    const row = insertResult.rows[0];
    const createdIncident: IncidenciaViaje = {
      id: formatEntityId("INC", row.id_incidencia, 3),
      id_viaje: formatEntityId("T", row.id_viaje, 3),
      id_conductor: formatEntityId("C", row.id_conductor, 2),
      id_agencia: formatEntityId("A", row.id_agencia, 2),
      tipo: row.tipo,
      descripcion: row.descripcion,
      nivel_gravedad: row.nivel_gravedad,
      latitude: row.latitude ? Number(row.latitude) : null,
      longitude: row.longitude ? Number(row.longitude) : null,
      created_at: row.created_at,
    };

    await writeAuditLog(
      {
        userId,
        agencyId: tripRow.id_agencia,
        action: "INCIDENT_REPORTED",
        entity: "incidencia_viaje",
        entityId: createdIncident.id,
        metadata: {
          tripId: tripValue,
          tipo: input.tipo,
          gravedad: input.nivel_gravedad,
        },
      },
      client,
    );

    return createdIncident;
  });
}

export async function getTripIncidents(
  user: SessionUser,
  tripValue: string,
): Promise<IncidenciaViaje[]> {
  const userId = requireUserId(user);
  const scopeAgencyId = agencyScopeId(user);
  const tripId = parseEntityId(tripValue, "T");
  if (!tripId) throw notFound("El viaje no existe.");

  const sessionDriverId =
    user.rol === "CONDUCTOR" ? await getConductorId(userId) : null;
  if (user.rol === "CONDUCTOR" && !sessionDriverId) {
    throw forbidden("Tu usuario no está vinculado a un conductor habilitado.");
  }

  const result = await query<{
    id_incidencia: number;
    id_viaje: number;
    id_conductor: number;
    conductor_nombre: string;
    id_agencia: number;
    agencia_nombre: string;
    tipo: IncidenciaViaje["tipo"];
    descripcion: string;
    nivel_gravedad: IncidenciaViaje["nivel_gravedad"];
    latitude: string | null;
    longitude: string | null;
    created_at: string;
  }>(
    `SELECT
       i.id_incidencia,
       i.id_viaje,
       i.id_conductor,
       p.nombres || ' ' || p.apellidos AS conductor_nombre,
       i.id_agencia,
       a.nombre AS agencia_nombre,
       i.tipo,
       i.descripcion,
       i.nivel_gravedad,
       i.latitude::text,
       i.longitude::text,
       TO_CHAR(i.created_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD HH24:MI:SS') AS created_at
     FROM incidencias_viajes i
     JOIN conductores c ON c.id_conductor = i.id_conductor
     LEFT JOIN usuarios u ON u.id_usuario = c.id_usuario
     LEFT JOIN personas p ON p.id_persona = u.id_persona
     JOIN agencias a ON a.id_agencia = i.id_agencia
     JOIN viajes v ON v.id_viaje = i.id_viaje
     WHERE i.id_viaje = $1
       AND ($2::integer IS NULL OR v.id_agencia = $2)
       AND ($3::integer IS NULL OR v.id_conductor = $3)
     ORDER BY i.created_at DESC`,
    [tripId, scopeAgencyId, sessionDriverId],
  );

  return result.rows.map((row) => ({
    id: formatEntityId("INC", row.id_incidencia, 3),
    id_viaje: formatEntityId("T", row.id_viaje, 3),
    id_conductor: formatEntityId("C", row.id_conductor, 2),
    conductor_nombre: row.conductor_nombre,
    id_agencia: formatEntityId("A", row.id_agencia, 2),
    agencia_nombre: row.agencia_nombre,
    tipo: row.tipo,
    descripcion: row.descripcion,
    nivel_gravedad: row.nivel_gravedad,
    latitude: row.latitude ? Number(row.latitude) : null,
    longitude: row.longitude ? Number(row.longitude) : null,
    created_at: row.created_at,
  }));
}

export async function updateDriverContact(
  user: SessionUser,
  input: DriverProfileUpdateInput,
): Promise<{ phone: string; email: string; address: string }> {
  const userId = requireUserId(user);
  return withTransaction(async (client) => {
    const userPerson = await client.query<{ id_persona: number }>(
      `SELECT u.id_persona
       FROM usuarios u
       WHERE u.id_usuario = $1 AND u.estado = 'ACTIVO'`,
      [userId],
    );
    const personId = userPerson.rows[0]?.id_persona;
    if (!personId) {
      throw notFound(
        "No se encontró el registro de persona asociado al usuario.",
      );
    }

    await client.query(
      `UPDATE personas
       SET telefono = COALESCE(NULLIF($1, ''), telefono),
           email = COALESCE(NULLIF($2, ''), email),
           direccion = COALESCE(NULLIF($3, ''), direccion),
           updated_at = NOW()
       WHERE id_persona = $4`,
      [
        input.phone || null,
        input.email || null,
        input.address || null,
        personId,
      ],
    );

    const updated = await client.query<{
      telefono: string | null;
      email: string | null;
      direccion: string | null;
    }>(
      `SELECT telefono, email, direccion FROM personas WHERE id_persona = $1`,
      [personId],
    );

    await writeAuditLog(
      {
        userId,
        agencyId: user.agenciaId ? parseEntityId(user.agenciaId, "A") : null,
        action: "DRIVER_PROFILE_UPDATED",
        entity: "persona",
        entityId: String(personId),
        metadata: {
          updatedFields: Object.keys(input),
        },
      },
      client,
    );

    return {
      phone: updated.rows[0]?.telefono || "",
      email: updated.rows[0]?.email || "",
      address: updated.rows[0]?.direccion || "",
    };
  });
}

export async function getDriverContact(
  user: SessionUser,
): Promise<{
  phone: string;
  email: string;
  address: string;
  photoUrl: string | null;
}> {
  const userId = requireUserId(user);
  const result = await query<{
    telefono: string | null;
    email: string | null;
    direccion: string | null;
    foto_actualizada_at: string | null;
  }>(
    `SELECT person.telefono, person.email, person.direccion,
            profile_photo.updated_at::text AS foto_actualizada_at
     FROM usuarios user_account
     LEFT JOIN personas person ON person.id_persona = user_account.id_persona
     LEFT JOIN conductores driver ON driver.id_usuario = user_account.id_usuario
     LEFT JOIN LATERAL (
       SELECT document.updated_at
       FROM documentos_operativos document
       WHERE document.id_conductor = driver.id_conductor
         AND document.titular_tipo = 'CONDUCTOR'
         AND document.tipo_documento = 'OTRO'
         AND document.numero = 'FOTO-PERFIL'
         AND document.archivo_contenido IS NOT NULL
       ORDER BY document.id_documento DESC
       LIMIT 1
     ) profile_photo ON TRUE
     WHERE user_account.id_usuario = $1
       AND user_account.estado = 'ACTIVO'
       AND (driver.estado = 'ACTIVO' OR driver.id_conductor IS NOT NULL)
     LIMIT 1`,
    [userId],
  );
  if (!result.rows[0]) {
    throw notFound("No se encontró el perfil del conductor.");
  }
  return {
    phone: result.rows[0].telefono || "",
    email: result.rows[0].email || "",
    address: result.rows[0].direccion || "",
    photoUrl: result.rows[0].foto_actualizada_at
      ? `/api/conductor/profile/photo?v=${encodeURIComponent(result.rows[0].foto_actualizada_at)}`
      : null,
  };
}

export async function getDriverProfilePhoto(
  user: SessionUser,
): Promise<Buffer> {
  const userId = requireUserId(user);
  const result = await query<{ archivo_contenido: Buffer | null }>(
    `SELECT document.archivo_contenido
     FROM usuarios user_account
     LEFT JOIN conductores driver ON driver.id_usuario = user_account.id_usuario
     JOIN documentos_operativos document
       ON document.id_conductor = driver.id_conductor
      AND document.titular_tipo = 'CONDUCTOR'
      AND document.tipo_documento = 'OTRO'
      AND document.numero = 'FOTO-PERFIL'
     WHERE user_account.id_usuario = $1
       AND user_account.estado = 'ACTIVO'
       AND (driver.estado = 'ACTIVO' OR driver.id_conductor IS NOT NULL)
       AND document.archivo_contenido IS NOT NULL
     ORDER BY document.id_documento DESC
     LIMIT 1`,
    [userId],
  );
  const contents = result.rows[0]?.archivo_contenido;
  if (!contents) throw notFound("El conductor aún no tiene una foto de perfil.");
  return contents;
}

export async function saveDriverProfilePhoto(
  user: SessionUser,
  contents: Buffer,
): Promise<string> {
  const userId = requireUserId(user);
  const updatedAt = await withTransaction(async (client) => {
    const driver = await client.query<{
      id_conductor: number;
      id_agencia_base: number;
    }>(
      `SELECT driver.id_conductor, NULL::integer AS id_agencia_base
       FROM usuarios user_account
       LEFT JOIN conductores driver ON driver.id_usuario = user_account.id_usuario
       WHERE user_account.id_usuario = $1
         AND user_account.estado = 'ACTIVO'
         AND (driver.estado = 'ACTIVO' OR driver.id_conductor IS NOT NULL)
       FOR SHARE`,
      [userId],
    );
    const currentDriver = driver.rows[0];
    if (!currentDriver) throw notFound("No se encontró el perfil del conductor.");

    const sha256 = createHash("sha256").update(contents).digest("hex");
    const result = await client.query<{ updated_at: string }>(
      `INSERT INTO documentos_operativos (
         id_agencia, titular_tipo, id_conductor, id_vehiculo,
         tipo_documento, numero, fecha_emision, fecha_vencimiento,
         estado, observacion, creado_por, origen_registro,
         archivo_nombre, archivo_mime, archivo_tamano, archivo_sha256,
         archivo_contenido
       )
       VALUES (
         $1, 'CONDUCTOR', $2, NULL,
         'OTRO', 'FOTO-PERFIL', CURRENT_DATE, (CURRENT_DATE + INTERVAL '100 years')::date,
         'VIGENTE', 'Fotografía de perfil del conductor', $3, 'CONDUCTOR',
         'foto-perfil.webp', 'image/webp', $4, $5, $6
       )
       ON CONFLICT (
         titular_tipo,
         (COALESCE(id_conductor, 0)),
         (COALESCE(id_vehiculo, 0)),
         tipo_documento,
         numero
       ) DO UPDATE SET
         archivo_nombre = EXCLUDED.archivo_nombre,
         archivo_mime = EXCLUDED.archivo_mime,
         archivo_tamano = EXCLUDED.archivo_tamano,
         archivo_sha256 = EXCLUDED.archivo_sha256,
         archivo_contenido = EXCLUDED.archivo_contenido,
         observacion = EXCLUDED.observacion,
         creado_por = EXCLUDED.creado_por,
         origen_registro = 'CONDUCTOR',
         estado = 'VIGENTE',
         updated_at = NOW()
       RETURNING updated_at::text`,
      [
        currentDriver.id_agencia_base,
        currentDriver.id_conductor,
        userId,
        contents.byteLength,
        sha256,
        contents,
      ],
    );
    const timestamp = result.rows[0]?.updated_at;
    if (!timestamp) throw notFound("No se pudo guardar la fotografía.");

    await writeAuditLog(
      {
        userId,
        agencyId: user.agenciaId ? parseEntityId(user.agenciaId, "A") : null,
        action: "DRIVER_PROFILE_PHOTO_UPDATED",
        entity: "conductor",
        entityId: user.conductorId || null,
        metadata: { bytes: contents.byteLength, sha256 },
      },
      client,
    );
    return timestamp;
  });
  return `/api/conductor/profile/photo?v=${encodeURIComponent(updatedAt)}`;
}

export async function deleteDriverProfilePhoto(
  user: SessionUser,
): Promise<void> {
  const userId = requireUserId(user);
  await withTransaction(async (client) => {
    const result = await client.query(
      `DELETE FROM documentos_operativos document
       USING usuarios user_account, conductores driver
       WHERE user_account.id_usuario = $1
         AND driver.id_usuario = user_account.id_usuario
         AND user_account.estado = 'ACTIVO'
         AND (driver.estado = 'ACTIVO' OR driver.id_conductor IS NOT NULL)
         AND document.id_conductor = driver.id_conductor
         AND document.titular_tipo = 'CONDUCTOR'
         AND document.tipo_documento = 'OTRO'
         AND document.numero = 'FOTO-PERFIL'
       RETURNING document.id_documento`,
      [userId],
    );

    await writeAuditLog(
      {
        userId,
        agencyId: user.agenciaId ? parseEntityId(user.agenciaId, "A") : null,
        action: "DRIVER_PROFILE_PHOTO_DELETED",
        entity: "conductor",
        entityId: user.conductorId || null,
        metadata: { existed: Boolean(result.rowCount) },
      },
      client,
    );
  });
}

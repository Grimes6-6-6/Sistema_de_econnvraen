import "server-only";

import type { QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import type { ManagedRoute, ManagedVehicle } from "@/lib/domain/admin";
import { formatEntityId, parseEntityId } from "@/lib/domain/ids";
import type {
  ManagedRouteInput,
  ManagedRouteUpdateInput,
  ManagedVehicleInput,
  ManagedVehicleUpdateInput,
} from "@/lib/validation/schemas";
import { writeAuditLog } from "@/server/audit";
import { query, withTransaction } from "@/server/db/pool";
import { conflict, forbidden, notFound } from "@/server/errors";

export interface RouteDestination {
  id: string;
  code: string;
  city: string;
  name: string;
}

interface RouteRow extends QueryResultRow {
  id_ruta: number;
  id_agencia_origen: number;
  id_agencia_destino: number;
  origen: string;
  destino: string;
  distancia_km: string;
  duracion_horas: string;
  precio_base: string;
  estado: ManagedRoute["state"];
}

interface VehicleRow extends QueryResultRow {
  id_vehiculo: number;
  id_agencia_base: number;
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  capacidad: number;
  anio: number | null;
  estado: ManagedVehicle["state"];
}

function actorId(user: SessionUser): number {
  const id = parseEntityId(user.id, "U");
  if (!id) throw forbidden();
  return id;
}

function activeAgencyId(user: SessionUser): number {
  const id = user.agenciaId ? parseEntityId(user.agenciaId, "A") : null;
  if (!id) throw forbidden("Selecciona una agencia activa.");
  return id;
}

function scopeAgencyId(user: SessionUser): number | null {
  return user.rol === "SUPER_ADMIN" ? null : activeAgencyId(user);
}

function assertAgencyAssignment(user: SessionUser, agencyId: number): void {
  if (user.rol !== "SUPER_ADMIN" && agencyId !== activeAgencyId(user)) {
    throw forbidden("Solo puedes gestionar recursos de tu agencia activa.");
  }
}

function mapRoute(row: RouteRow): ManagedRoute {
  return {
    id: formatEntityId("R", row.id_ruta, 2),
    originAgencyId: formatEntityId("A", row.id_agencia_origen),
    destinationAgencyId: formatEntityId("A", row.id_agencia_destino),
    origin: row.origen,
    destination: row.destino,
    distanceKm: Number(row.distancia_km),
    durationHours: Number(row.duracion_horas),
    price: Number(row.precio_base),
    state: row.estado,
  };
}

function mapVehicle(row: VehicleRow): ManagedVehicle {
  return {
    id: formatEntityId("V", row.id_vehiculo, 2),
    agencyId: formatEntityId("A", row.id_agencia_base),
    plate: row.placa,
    type: row.tipo,
    brand: row.marca,
    model: row.modelo,
    capacity: row.capacidad,
    year: row.anio,
    state: row.estado,
  };
}

const ROUTE_SELECT = `SELECT route.id_ruta, route.id_agencia_origen, route.id_agencia_destino,
  route.origen, route.destino, route.distancia_km::text, route.duracion_horas::text,
  route.precio_base::text, route.estado FROM rutas route`;

const VEHICLE_SELECT = `SELECT vehicle.id_vehiculo, vehicle.id_agencia_base, vehicle.placa,
  vehicle.tipo, vehicle.marca, vehicle.modelo, vehicle.capacidad, vehicle.anio,
  vehicle.estado FROM vehiculos vehicle`;

export async function listRouteDestinations(): Promise<RouteDestination[]> {
  const result = await query<{
    id_agencia: number;
    codigo: string;
    ciudad: string;
    nombre: string;
  }>(
    `SELECT id_agencia, codigo, ciudad, nombre
     FROM agencias WHERE estado = 'ACTIVA' ORDER BY ciudad, nombre`,
  );
  return result.rows.map((row) => ({
    id: formatEntityId("A", row.id_agencia),
    code: row.codigo,
    city: row.ciudad,
    name: row.nombre,
  }));
}

export async function listManagedRoutes(user: SessionUser): Promise<ManagedRoute[]> {
  const agencyId = scopeAgencyId(user);
  const result = await query<RouteRow>(
    `${ROUTE_SELECT}
     WHERE $1::integer IS NULL OR route.id_agencia_origen = $1
     ORDER BY route.origen, route.destino`,
    [agencyId],
  );
  return result.rows.map(mapRoute);
}

async function agencyNames(originId: number, destinationId: number) {
  const result = await query<{ id_agencia: number; ciudad: string }>(
    `SELECT id_agencia, ciudad FROM agencias
     WHERE id_agencia = ANY($1::integer[]) AND estado = 'ACTIVA'`,
    [[originId, destinationId]],
  );
  if (result.rowCount !== 2) throw conflict("AGENCY_NOT_AVAILABLE", "El origen o destino no está activo.");
  const origin = result.rows.find((row) => row.id_agencia === originId)!;
  const destination = result.rows.find((row) => row.id_agencia === destinationId)!;
  return { origin: origin.ciudad, destination: destination.ciudad };
}

export async function createManagedRoute(
  user: SessionUser,
  input: ManagedRouteInput,
): Promise<ManagedRoute> {
  const originId = parseEntityId(input.originAgencyId, "A");
  const destinationId = parseEntityId(input.destinationAgencyId, "A");
  if (!originId || !destinationId) throw notFound("La agencia no existe.");
  assertAgencyAssignment(user, originId);
  const names = await agencyNames(originId, destinationId);

  const id = await withTransaction(async (client) => {
    const created = await client.query<{ id_ruta: number }>(
      `INSERT INTO rutas (
         origen, destino, distancia_km, duracion_horas, precio_base, estado,
         id_agencia_origen, id_agencia_destino
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id_ruta`,
      [names.origin, names.destination, input.distanceKm, input.durationHours, input.price, input.state, originId, destinationId],
    );
    const routeId = created.rows[0].id_ruta;
    await writeAuditLog(
      {
        userId: actorId(user),
        agencyId: originId,
        action: "ROUTE_CREATED",
        entity: "ruta",
        entityId: formatEntityId("R", routeId, 2),
        metadata: { destinationAgencyId: input.destinationAgencyId, price: input.price },
      },
      client,
    );
    return routeId;
  });
  const result = await query<RouteRow>(`${ROUTE_SELECT} WHERE route.id_ruta = $1`, [id]);
  return mapRoute(result.rows[0]);
}

export async function updateManagedRoute(
  user: SessionUser,
  routeIdValue: string,
  input: ManagedRouteUpdateInput,
): Promise<ManagedRoute> {
  const routeId = parseEntityId(routeIdValue, "R");
  if (!routeId) throw notFound("La ruta no existe.");
  const current = await query<RouteRow>(`${ROUTE_SELECT} WHERE route.id_ruta = $1`, [routeId]);
  const route = current.rows[0];
  if (!route) throw notFound("La ruta no existe.");
  assertAgencyAssignment(user, route.id_agencia_origen);
  const originId = input.originAgencyId ? parseEntityId(input.originAgencyId, "A") : route.id_agencia_origen;
  const destinationId = input.destinationAgencyId ? parseEntityId(input.destinationAgencyId, "A") : route.id_agencia_destino;
  if (!originId || !destinationId || originId === destinationId) throw conflict("INVALID_ROUTE", "El origen y destino no son válidos.");
  assertAgencyAssignment(user, originId);
  const names = await agencyNames(originId, destinationId);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE rutas SET origen = $1, destino = $2,
         id_agencia_origen = $3, id_agencia_destino = $4,
         distancia_km = COALESCE($5, distancia_km),
         duracion_horas = COALESCE($6, duracion_horas),
         precio_base = COALESCE($7, precio_base),
         estado = COALESCE($8, estado), updated_at = NOW()
       WHERE id_ruta = $9`,
      [names.origin, names.destination, originId, destinationId, input.distanceKm ?? null, input.durationHours ?? null, input.price ?? null, input.state ?? null, routeId],
    );
    await writeAuditLog(
      {
        userId: actorId(user), agencyId: originId, action: "ROUTE_UPDATED",
        entity: "ruta", entityId: routeIdValue,
        metadata: { fields: Object.keys(input), price: input.price },
      },
      client,
    );
  });
  const updated = await query<RouteRow>(`${ROUTE_SELECT} WHERE route.id_ruta = $1`, [routeId]);
  return mapRoute(updated.rows[0]);
}

export async function listManagedVehicles(user: SessionUser): Promise<ManagedVehicle[]> {
  const agencyId = scopeAgencyId(user);
  const result = await query<VehicleRow>(
    `${VEHICLE_SELECT} WHERE $1::integer IS NULL OR vehicle.id_agencia_base = $1 ORDER BY vehicle.placa`,
    [agencyId],
  );
  return result.rows.map(mapVehicle);
}

export async function createManagedVehicle(
  user: SessionUser,
  input: ManagedVehicleInput,
): Promise<ManagedVehicle> {
  const agencyId = parseEntityId(input.agencyId, "A");
  if (!agencyId) throw notFound("La agencia no existe.");
  assertAgencyAssignment(user, agencyId);
  const id = await withTransaction(async (client) => {
    const created = await client.query<{ id_vehiculo: number }>(
      `INSERT INTO vehiculos (
         placa, tipo, marca, modelo, capacidad, anio, estado, id_agencia_base
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id_vehiculo`,
      [input.plate, input.type, input.brand, input.model, input.capacity, input.year ?? null, input.state, agencyId],
    );
    const vehicleId = created.rows[0].id_vehiculo;
    await writeAuditLog(
      { userId: actorId(user), agencyId, action: "VEHICLE_CREATED", entity: "vehiculo", entityId: formatEntityId("V", vehicleId, 2), metadata: { plate: input.plate } },
      client,
    );
    return vehicleId;
  });
  const result = await query<VehicleRow>(`${VEHICLE_SELECT} WHERE vehicle.id_vehiculo = $1`, [id]);
  return mapVehicle(result.rows[0]);
}

export async function updateManagedVehicle(
  user: SessionUser,
  vehicleIdValue: string,
  input: ManagedVehicleUpdateInput,
): Promise<ManagedVehicle> {
  const vehicleId = parseEntityId(vehicleIdValue, "V");
  if (!vehicleId) throw notFound("El vehículo no existe.");
  const current = await query<VehicleRow>(`${VEHICLE_SELECT} WHERE vehicle.id_vehiculo = $1`, [vehicleId]);
  const vehicle = current.rows[0];
  if (!vehicle) throw notFound("El vehículo no existe.");
  assertAgencyAssignment(user, vehicle.id_agencia_base);
  const nextAgencyId = input.agencyId ? parseEntityId(input.agencyId, "A") : vehicle.id_agencia_base;
  if (!nextAgencyId) throw notFound("La agencia no existe.");
  assertAgencyAssignment(user, nextAgencyId);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE vehiculos SET id_agencia_base = $1,
         placa = COALESCE($2, placa), tipo = COALESCE($3, tipo),
         marca = COALESCE($4, marca), modelo = COALESCE($5, modelo),
         capacidad = COALESCE($6, capacidad),
         anio = CASE WHEN $7::integer IS NULL THEN anio ELSE $7 END,
         estado = COALESCE($8, estado), updated_at = NOW()
       WHERE id_vehiculo = $9`,
      [nextAgencyId, input.plate ?? null, input.type ?? null, input.brand ?? null, input.model ?? null, input.capacity ?? null, input.year ?? null, input.state ?? null, vehicleId],
    );
    await writeAuditLog(
      { userId: actorId(user), agencyId: nextAgencyId, action: "VEHICLE_UPDATED", entity: "vehiculo", entityId: vehicleIdValue, metadata: { fields: Object.keys(input), state: input.state } },
      client,
    );
  });
  const updated = await query<VehicleRow>(`${VEHICLE_SELECT} WHERE vehicle.id_vehiculo = $1`, [vehicleId]);
  return mapVehicle(updated.rows[0]);
}

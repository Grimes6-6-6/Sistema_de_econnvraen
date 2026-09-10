import type { Ruta, Viaje } from "@/lib/domain/types";

const ACTIVE_TRIP_STATES = new Set<Viaje["estado"]>([
  "programado",
  "en_curso",
]);

export interface TripResourceConflict {
  tripId: string;
  busyUntilDate: string;
  busyUntilTime: string;
}

export interface TripResourceConflicts {
  drivers: Map<string, TripResourceConflict>;
  vehicles: Map<string, TripResourceConflict>;
}

interface TripCandidate {
  routeId: string;
  date: string;
  time: string;
}

interface TripAvailabilityInput {
  routes: Ruta[];
  trips: Viaje[];
  candidate: TripCandidate;
}

function parseWallClock(date: string, time: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;

  const timestamp = Date.UTC(year, month - 1, day, hour, minute);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

function parseDurationHours(route: Ruta | undefined): number | null {
  if (!route) return null;
  const duration = Number.parseFloat(route.duracion.replace(",", "."));
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function formatWallClock(timestamp: number): Pick<
  TripResourceConflict,
  "busyUntilDate" | "busyUntilTime"
> {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return {
    busyUntilDate: `${year}-${month}-${day}`,
    busyUntilTime: `${hour}:${minute}`,
  };
}

function keepLatestConflict(
  conflicts: Map<string, TripResourceConflict>,
  resourceId: string,
  tripId: string,
  busyUntil: number,
) {
  const next = { tripId, ...formatWallClock(busyUntil) };
  const current = conflicts.get(resourceId);
  if (!current) {
    conflicts.set(resourceId, next);
    return;
  }

  const currentEnd = parseWallClock(
    current.busyUntilDate,
    current.busyUntilTime,
  );
  if (currentEnd === null || busyUntil > currentEnd) {
    conflicts.set(resourceId, next);
  }
}

export function getTripResourceConflicts({
  routes,
  trips,
  candidate,
}: TripAvailabilityInput): TripResourceConflicts {
  const drivers = new Map<string, TripResourceConflict>();
  const vehicles = new Map<string, TripResourceConflict>();
  const candidateStart = parseWallClock(candidate.date, candidate.time);
  const candidateDuration = parseDurationHours(
    routes.find((route) => route.id === candidate.routeId),
  );
  if (candidateStart === null || candidateDuration === null) {
    return { drivers, vehicles };
  }

  const candidateEnd = candidateStart + candidateDuration * 60 * 60 * 1_000;
  for (const trip of trips) {
    if (!ACTIVE_TRIP_STATES.has(trip.estado)) continue;

    const existingStart = parseWallClock(trip.fecha, trip.hora);
    const existingDuration = parseDurationHours(
      routes.find((route) => route.id === trip.id_ruta),
    );
    if (existingStart === null || existingDuration === null) continue;

    const existingEnd = existingStart + existingDuration * 60 * 60 * 1_000;
    const overlaps = existingStart < candidateEnd && candidateStart < existingEnd;
    if (!overlaps) continue;

    keepLatestConflict(
      drivers,
      trip.id_conductor,
      trip.id,
      existingEnd,
    );
    keepLatestConflict(
      vehicles,
      trip.id_vehiculo,
      trip.id,
      existingEnd,
    );
  }

  return { drivers, vehicles };
}

export function formatConflictEnd(
  conflict: TripResourceConflict,
  candidateDate: string,
): string {
  return conflict.busyUntilDate === candidateDate
    ? conflict.busyUntilTime
    : `${conflict.busyUntilDate} ${conflict.busyUntilTime}`;
}

import type { Ruta, Viaje } from "@/lib/domain/types";

const ACTIVE_TRIP_STATES = new Set<Viaje["estado"]>([
  "programado",
  "en_curso",
]);

export interface TripResourceConflict {
  tripId: string;
  busyUntilDate: string;
  busyUntilTime: string;
  requiresCompletion: boolean;
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
  referenceNow?: Pick<TripCandidate, "date" | "time">;
}

export function getPeruWallClock(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

export function isTripOpenForBooking(trip: Viaje, now = new Date()): boolean {
  if (trip.estado !== "programado") return false;
  const departure = parseWallClock(trip.fecha, trip.hora);
  // Peru uses UTC-05:00; trip dates and times are stored in that wall clock.
  return departure !== null && departure + 5 * 60 * 60 * 1_000 > now.getTime();
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
  requiresCompletion: boolean,
) {
  const next = {
    tripId,
    ...formatWallClock(busyUntil),
    requiresCompletion,
  };
  const current = conflicts.get(resourceId);
  if (!current) {
    conflicts.set(resourceId, next);
    return;
  }

  if (current.requiresCompletion !== requiresCompletion) {
    if (requiresCompletion) conflicts.set(resourceId, next);
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
  referenceNow,
}: TripAvailabilityInput): TripResourceConflicts {
  const drivers = new Map<string, TripResourceConflict>();
  const vehicles = new Map<string, TripResourceConflict>();
  const candidateStart = parseWallClock(candidate.date, candidate.time);
  const reference = referenceNow ?? getPeruWallClock();
  const referenceTimestamp = parseWallClock(reference.date, reference.time);
  const candidateDuration = parseDurationHours(
    routes.find((route) => route.id === candidate.routeId),
  );
  if (candidateStart === null) {
    return { drivers, vehicles };
  }

  const candidateEnd =
    candidateDuration === null
      ? null
      : candidateStart + candidateDuration * 60 * 60 * 1_000;
  for (const trip of trips) {
    if (!ACTIVE_TRIP_STATES.has(trip.estado)) continue;

    const existingStart = parseWallClock(trip.fecha, trip.hora);
    const existingDuration = parseDurationHours(
      routes.find((route) => route.id === trip.id_ruta),
    );
    if (existingStart === null) continue;
    const requiresCompletion =
      trip.estado === "en_curso" ||
      (referenceTimestamp !== null && existingStart <= referenceTimestamp);
    if (existingDuration === null && !requiresCompletion) continue;

    const existingEnd = existingStart + (existingDuration ?? 0) * 60 * 60 * 1_000;
    const overlaps =
      candidateEnd !== null &&
      existingStart < candidateEnd &&
      candidateStart < existingEnd;
    if (!requiresCompletion && !overlaps) continue;

    keepLatestConflict(
      drivers,
      trip.id_conductor,
      trip.id,
      existingEnd,
      requiresCompletion,
    );
    keepLatestConflict(
      vehicles,
      trip.id_vehiculo,
      trip.id,
      existingEnd,
      requiresCompletion,
    );
  }

  return { drivers, vehicles };
}

export function formatConflictEnd(
  conflict: TripResourceConflict,
  candidateDate: string,
): string {
  if (conflict.requiresCompletion) {
    return `finalizar ${conflict.tripId}`;
  }
  return conflict.busyUntilDate === candidateDate
    ? conflict.busyUntilTime
    : `${conflict.busyUntilDate} ${conflict.busyUntilTime}`;
}

import type { VehicleLocation } from "./types";

export const GPS_FRESH_SECONDS = 45;
export const GPS_RETRY_MAX_AGE_MS = 15 * 60_000;

export function isDriverTripVisible(trip: { id_conductor: string; fecha: string; estado: string }, driverId: string, today: string) {
  return trip.id_conductor === driverId && (trip.fecha === today || trip.estado === "en_curso");
}

// Server age + elapsed monotonic time: a client clock offset must not refresh a marker.
export function ageVehicleLocations(items: VehicleLocation[], elapsedMs: number): VehicleLocation[] {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  return items.map((item) => {
    const ageSeconds = item.ageSeconds + seconds;
    return { ...item, ageSeconds, isActive: item.isActive && ageSeconds <= GPS_FRESH_SECONDS };
  });
}

export function canRetryGps(capturedAt: string, now: number) {
  const age = now - Date.parse(capturedAt);
  return Number.isFinite(age) && age >= -60_000 && age < GPS_RETRY_MAX_AGE_MS;
}

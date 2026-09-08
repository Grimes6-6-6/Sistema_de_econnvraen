import { describe, expect, it } from "vitest";
import { ageVehicleLocations, canRetryGps, isDriverTripVisible } from "@/lib/domain/gps";
import type { VehicleLocation } from "@/lib/domain/types";

const point: VehicleLocation = { conductorId: "C01", conductorName: "Test", routeLabel: "Test", placa: "TEST", lat: 0, lng: 0, accuracy: 10, speed: null, heading: null, timestamp: 1000, ageSeconds: 20, isActive: true };

describe("Vigencia de GPS", () => {
  it("mantiene viajes en curso después de medianoche, solo del conductor", () => {
    const trip = { id_conductor: "C01", fecha: "2026-09-05", estado: "en_curso" };
    expect(isDriverTripVisible(trip, "C01", "2026-09-06")).toBe(true);
    expect(isDriverTripVisible(trip, "C02", "2026-09-06")).toBe(false);
    expect(isDriverTripVisible({ ...trip, estado: "finalizado" }, "C01", "2026-09-06")).toBe(false);
  });
  it("caduca una señal aunque todas las consultas posteriores fallen", () => {
    expect(ageVehicleLocations([point], 26_000)[0]).toMatchObject({ ageSeconds: 46, isActive: false });
  });
  it("conserva activa una posición reciente, sin depender del reloj del teléfono", () => {
    expect(ageVehicleLocations([point], 24_000)[0].isActive).toBe(true);
  });
  it("no reactiva un GPS detenido ni modifica el snapshot original", () => {
    expect(ageVehicleLocations([{ ...point, isActive: false }], 0)[0].isActive).toBe(false);
    ageVehicleLocations([point], 50_000);
    expect(point.ageSeconds).toBe(20);
  });
  it("no refresca una posición antigua recibida hace poco", () => {
    expect(ageVehicleLocations([{ ...point, ageSeconds: 600, isActive: false }], 0)[0].isActive).toBe(false);
  });
  it("no reintenta posiciones caducadas o marcas de tiempo inválidas", () => {
    const now = Date.parse("2026-09-06T12:00:00Z");
    expect(canRetryGps("2026-09-06T11:44:59Z", now)).toBe(false);
    expect(canRetryGps("2026-09-06T11:59:59Z", now)).toBe(true);
    expect(canRetryGps("invalid", now)).toBe(false);
    expect(canRetryGps("2026-09-06T12:10:00Z", now)).toBe(false);
  });
});

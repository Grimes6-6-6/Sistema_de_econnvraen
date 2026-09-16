import { describe, expect, it } from "vitest";
import {
  formatConflictEnd,
  getPeruWallClock,
  getTripResourceConflicts,
  isTripOpenForBooking,
} from "@/lib/domain/trip-availability";
import type { Ruta, Viaje } from "@/lib/domain/types";

const routes: Ruta[] = [
  {
    id: "R01",
    origen: "Ayacucho",
    destino: "Kimbiri",
    distancia: "135",
    duracion: "4.5",
    precio: 55,
  },
];

const scheduledTrip: Viaje = {
  id: "T001",
  id_ruta: "R01",
  id_vehiculo: "V02",
  id_conductor: "C01",
  fecha: "2026-09-10",
  hora: "02:00",
  estado: "programado",
  precio: 55,
};

describe("disponibilidad de recursos del viaje", () => {
  it("no acepta pasajes ni encomiendas a las 06:00 para la salida de las 02:00", () => {
    expect(isTripOpenForBooking(scheduledTrip, new Date("2026-09-10T06:00:00-05:00"))).toBe(false);
  });

  it("cierra la recepción exactamente a la hora de salida", () => {
    expect(isTripOpenForBooking(scheduledTrip, new Date("2026-09-10T01:59:59-05:00"))).toBe(true);
    expect(isTripOpenForBooking(scheduledTrip, new Date("2026-09-10T02:00:00-05:00"))).toBe(false);
  });

  it("no acepta reservas de un viaje iniciado aunque su hora prevista sea futura", () => {
    expect(isTripOpenForBooking({ ...scheduledTrip, estado: "en_curso" }, new Date("2026-09-10T01:00:00-05:00"))).toBe(false);
  });

  it("rechaza salidas con una fecha inválida", () => {
    expect(isTripOpenForBooking({ ...scheduledTrip, fecha: "2026-02-30" })).toBe(false);
  });

  it("marca conductor y vehículo ocupados cuando el horario se cruza", () => {
    const conflicts = getTripResourceConflicts({
      routes,
      trips: [scheduledTrip],
      candidate: {
        routeId: "R01",
        date: "2026-09-10",
        time: "04:00",
      },
      referenceNow: { date: "2026-09-09", time: "18:00" },
    });

    expect(conflicts.drivers.get("C01")).toMatchObject({
      tripId: "T001",
      busyUntilDate: "2026-09-10",
      busyUntilTime: "06:30",
    });
    expect(conflicts.vehicles.get("V02")).toMatchObject({
      busyUntilTime: "06:30",
    });
  });

  it("permite planificar otro viaje al terminar el anterior si ambos aún son futuros", () => {
    const conflicts = getTripResourceConflicts({
      routes,
      trips: [scheduledTrip],
      candidate: {
        routeId: "R01",
        date: "2026-09-10",
        time: "06:30",
      },
      referenceNow: { date: "2026-09-09", time: "18:00" },
    });

    expect(conflicts.drivers.size).toBe(0);
    expect(conflicts.vehicles.size).toBe(0);
  });

  it("mantiene ocupado el recurso después de la salida hasta finalizar el viaje", () => {
    const conflicts = getTripResourceConflicts({
      routes,
      trips: [scheduledTrip],
      candidate: {
        routeId: "R01",
        date: "2026-09-10",
        time: "08:00",
      },
      referenceNow: { date: "2026-09-10", time: "07:00" },
    });

    expect(conflicts.drivers.get("C01")).toMatchObject({
      tripId: "T001",
      requiresCompletion: true,
    });
    expect(conflicts.vehicles.get("V02")).toMatchObject({
      requiresCompletion: true,
    });
  });

  it("detecta un viaje no finalizado incluso antes de seleccionar la ruta", () => {
    const conflicts = getTripResourceConflicts({
      routes,
      trips: [scheduledTrip],
      candidate: {
        routeId: "",
        date: "2026-09-10",
        time: "08:00",
      },
      referenceNow: { date: "2026-09-10", time: "07:00" },
    });

    expect(conflicts.vehicles.has("V02")).toBe(true);
  });

  it("no libera a las 06:00 un vehículo que salió a las 02:00 con duración de 4 horas", () => {
    const conflicts = getTripResourceConflicts({
      routes: [{ ...routes[0], duracion: "4h" }],
      trips: [scheduledTrip],
      candidate: { routeId: "R01", date: "2026-09-10", time: "06:00" },
      referenceNow: { date: "2026-09-10", time: "06:00" },
    });

    expect(conflicts.vehicles.get("V02")?.requiresCompletion).toBe(true);
    expect(conflicts.drivers.get("C01")?.requiresCompletion).toBe(true);
  });

  it("bloquea un viaje en curso aunque se haya iniciado antes de su horario previsto", () => {
    const conflicts = getTripResourceConflicts({
      routes,
      trips: [{ ...scheduledTrip, hora: "08:00", estado: "en_curso" }],
      candidate: { routeId: "R01", date: "2026-09-11", time: "06:00" },
      referenceNow: { date: "2026-09-10", time: "07:00" },
    });

    expect(conflicts.vehicles.get("V02")?.requiresCompletion).toBe(true);
  });

  it("no libera recursos de un viaje iniciado si su ruta ya no está en el catálogo", () => {
    const conflicts = getTripResourceConflicts({
      routes: [],
      trips: [scheduledTrip],
      candidate: { routeId: "", date: "2026-09-11", time: "06:00" },
      referenceNow: { date: "2026-09-10", time: "07:00" },
    });

    expect(conflicts.vehicles.get("V02")?.requiresCompletion).toBe(true);
  });

  it("usa la fecha y hora de Perú, incluso cerca del cambio de día UTC", () => {
    expect(getPeruWallClock(new Date("2026-09-11T02:30:00Z"))).toEqual({
      date: "2026-09-10",
      time: "21:30",
    });
    expect(getPeruWallClock(new Date("2026-09-11T05:00:00Z"))).toEqual({
      date: "2026-09-11",
      time: "00:00",
    });
  });

  it("ignora viajes completados y cancelados", () => {
    const conflicts = getTripResourceConflicts({
      routes,
      trips: [
        { ...scheduledTrip, estado: "completado" },
        { ...scheduledTrip, id: "T002", estado: "cancelado" },
      ],
      candidate: {
        routeId: "R01",
        date: "2026-09-10",
        time: "04:00",
      },
      referenceNow: { date: "2026-09-10", time: "07:00" },
    });

    expect(conflicts.drivers.size).toBe(0);
    expect(conflicts.vehicles.size).toBe(0);
  });

  it("muestra solo la hora cuando la ocupación termina el mismo día", () => {
    expect(
      formatConflictEnd(
        {
          tripId: "T001",
          busyUntilDate: "2026-09-10",
          busyUntilTime: "06:30",
          requiresCompletion: false,
        },
        "2026-09-10",
      ),
    ).toBe("06:30");
  });

  it("indica que un viaje iniciado debe finalizarse", () => {
    expect(
      formatConflictEnd(
        {
          tripId: "T001",
          busyUntilDate: "2026-09-10",
          busyUntilTime: "06:30",
          requiresCompletion: true,
        },
        "2026-09-10",
      ),
    ).toBe("finalizar T001");
  });
});

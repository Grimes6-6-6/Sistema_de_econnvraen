import { describe, expect, it } from "vitest";
import {
  formatConflictEnd,
  getTripResourceConflicts,
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
  it("marca conductor y vehículo ocupados cuando el horario se cruza", () => {
    const conflicts = getTripResourceConflicts({
      routes,
      trips: [scheduledTrip],
      candidate: {
        routeId: "R01",
        date: "2026-09-10",
        time: "04:00",
      },
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

  it("permite utilizar el recurso exactamente al terminar el viaje anterior", () => {
    const conflicts = getTripResourceConflicts({
      routes,
      trips: [scheduledTrip],
      candidate: {
        routeId: "R01",
        date: "2026-09-10",
        time: "06:30",
      },
    });

    expect(conflicts.drivers.size).toBe(0);
    expect(conflicts.vehicles.size).toBe(0);
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
        },
        "2026-09-10",
      ),
    ).toBe("06:30");
  });
});

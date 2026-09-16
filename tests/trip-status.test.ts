import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));

import { updateTripStatus } from "@/server/data/operations";

const driver: SessionUser = {
  id: "U007",
  username: "conductor",
  nombres: "Conductor",
  apellidos: "Prueba",
  rol: "CONDUCTOR",
  dni: "12345678",
  conductorId: "C02",
  agenciaId: "A01",
  agenciaNombre: "Ayacucho",
  mustChangePassword: false,
};

const emptyResult = { rows: [], rowCount: 0 };
const parcels = [
  { id_encomienda: 11, codigo_tracking: "TRACK-11" },
  { id_encomienda: 12, codigo_tracking: "TRACK-12" },
];

describe("estado y llegada del viaje", () => {
  let current: {
    id_viaje: number;
    id_conductor: number;
    id_agencia: number;
    estado: string;
    is_today: boolean;
  };
  let scopeMatches: boolean;
  let failSql: string | null;
  let dbState: string;
  const transactionQuery = vi.fn();
  const poolQuery = vi.fn();
  const release = vi.fn();
  const connect = vi.fn();
  const previousPool = globalThis.__econnvraePool;

  beforeEach(() => {
    vi.clearAllMocks();
    current = {
      id_viaje: 3,
      id_conductor: 2,
      id_agencia: 1,
      estado: "EN_CURSO",
      is_today: false,
    };
    scopeMatches = true;
    failSql = null;
    dbState = "EN_CURSO";
    poolQuery.mockResolvedValue({ rows: [{ id: 2 }], rowCount: 1 });
    transactionQuery.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (failSql && sql.includes(failSql)) {
        throw new Error("SIMULATED_WRITE_FAILURE");
      }
      if (sql.includes("AS is_today")) {
        return { rows: scopeMatches ? [current] : [], rowCount: scopeMatches ? 1 : 0 };
      }
      if (sql.includes("UPDATE viajes")) {
        dbState = values?.[0] as string;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM encomiendas")) {
        return { rows: parcels, rowCount: parcels.length };
      }
      if (sql.includes("SELECT v.id_viaje")) {
        return {
          rows: [{
            id_viaje: 3,
            id_ruta: 1,
            id_vehiculo: 4,
            id_conductor: 2,
            fecha: "2026-09-15",
            hora: "23:00",
            estado: dbState,
            precio_final: "55",
            fecha_llegada: dbState === "COMPLETADO" ? "2026-09-16 01:00" : null,
          }],
          rowCount: 1,
        };
      }
      return emptyResult;
    });
    connect.mockResolvedValue({ query: transactionQuery, release });
    globalThis.__econnvraePool = { query: poolQuery, connect } as never;
  });

  afterEach(() => {
    globalThis.__econnvraePool = previousPool;
  });

  function statements() {
    return transactionQuery.mock.calls.map(([sql]) => sql as string);
  }

  function expectRolledBackWithoutWrites() {
    expect(statements()[0]).toBe("BEGIN");
    expect(statements().at(-1)).toBe("ROLLBACK");
    expect(statements()).not.toContain("COMMIT");
    expect(statements().filter((sql) => /^\s*(UPDATE|INSERT)/.test(sql))).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  }

  it("finaliza el viaje propio de ayer y registra encomiendas, GPS y auditoría en una sola transacción", async () => {
    const result = await updateTripStatus(driver, "T003", { newState: "completado" });

    expect(result).toMatchObject({
      id: "T003",
      estado: "completado",
      fecha: "2026-09-15",
      fechaLlegada: "2026-09-16 01:00",
    });
    expect(connect).toHaveBeenCalledOnce();
    expect(transactionQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(transactionQuery).toHaveBeenLastCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
    expect(poolQuery).toHaveBeenCalledOnce();
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining("FROM conductores"), [7]);
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND ($2::integer IS NULL OR id_agencia = $2)"),
      [3, 1],
    );
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE viajes"), ["COMPLETADO", 3],
    );
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id_viaje = $1 AND estado = 'EN_TRANSITO'"), [3],
    );
    const trackingCalls = transactionQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO tracking_encomiendas"));
    const auditCalls = transactionQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO audit_logs"));
    expect(trackingCalls).toHaveLength(2);
    expect(auditCalls).toHaveLength(3);
    for (const [index, parcel] of parcels.entries()) {
      expect(transactionQuery).toHaveBeenCalledWith(
        expect.stringContaining("SET estado = 'EN_DESTINO'"), [parcel.id_encomienda],
      );
      expect(trackingCalls[index][0]).toContain("'EN_DESTINO', 'Agencia de destino'");
      expect(trackingCalls[index][1]).toEqual([
        parcel.id_encomienda,
        7,
        "Llegada registrada por el conductor del viaje T003.",
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ]);
      expect(auditCalls[index][1]).toEqual([
        7, 1, "PARCEL_STATUS_UPDATED", "encomienda", `E0${parcel.id_encomienda}`,
        JSON.stringify({
          from: "en_transito",
          to: "en_destino",
          tripId: "T003",
          trackingCode: parcel.codigo_tracking,
          source: "trip_arrival",
        }),
        null,
      ]);
    }
    expect(trackingCalls[0][1]?.[3]).not.toBe(trackingCalls[1][1]?.[3]);
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE ubicaciones_vehiculos"), [2, 3, 7],
    );
    expect(auditCalls[2][1]).toEqual([
      7, 1, "TRIP_COMPLETED", "viaje", "T003",
      JSON.stringify({ from: "EN_CURSO", to: "COMPLETADO" }), null,
    ]);
    expect(statements().some((sql) => sql.includes("SET estado = 'ENTREGADO'"))).toBe(false);
  });

  it("deniega registrar la llegada del viaje de otro conductor", async () => {
    current.id_conductor = 5;
    await expect(updateTripStatus(driver, "T003", { newState: "completado" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expectRolledBackWithoutWrites();
  });

  it.each(["ayer", "mañana"])("no permite iniciar un viaje programado de %s", async () => {
    current.estado = "PROGRAMADO";
    current.is_today = false;
    await expect(updateTripStatus(driver, "T003", { newState: "en_curso" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expectRolledBackWithoutWrites();
  });

  it("permite iniciar el viaje programado propio de hoy sin adelantar las encomiendas", async () => {
    current.estado = "PROGRAMADO";
    current.is_today = true;
    await expect(updateTripStatus(driver, "T003", { newState: "en_curso" }))
      .resolves.toMatchObject({ estado: "en_curso", fechaLlegada: null });
    expect(transactionQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE viajes"), ["EN_CURSO", 3]);
    expect(statements().some((sql) => sql.includes("FROM encomiendas"))).toBe(false);
    expect(transactionQuery).toHaveBeenLastCalledWith("COMMIT");
  });

  it.each(["PROGRAMADO", "COMPLETADO", "CANCELADO"])("no finaliza un viaje de otro día en estado %s", async (state) => {
    current.estado = state;
    await expect(updateTripStatus(driver, "T003", { newState: "completado" }))
      .rejects.toMatchObject({ code: "INVALID_TRIP_TRANSITION", status: 409 });
    expectRolledBackWithoutWrites();
  });

  it("mantiene la restricción de agencia aunque el viaje siga en curso", async () => {
    scopeMatches = false;
    await expect(updateTripStatus(driver, "T003", { newState: "completado" }))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(poolQuery).not.toHaveBeenCalled();
    expectRolledBackWithoutWrites();
  });

  it.each(["INSERT INTO tracking_encomiendas", "INSERT INTO audit_logs"])("revierte toda la llegada si falla %s", async (sql) => {
    failSql = sql;
    await expect(updateTripStatus(driver, "T003", { newState: "completado" }))
      .rejects.toThrow("SIMULATED_WRITE_FAILURE");
    expect(transactionQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE viajes"), ["COMPLETADO", 3]);
    expect(transactionQuery).toHaveBeenCalledWith(expect.stringContaining("SET estado = 'EN_DESTINO'"), [11]);
    expect(statements()[0]).toBe("BEGIN");
    expect(statements().at(-1)).toBe("ROLLBACK");
    expect(statements()).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
});

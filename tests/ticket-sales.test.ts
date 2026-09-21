import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { Boleto } from "@/lib/domain/types";
import { ticketsSoldOn } from "@/lib/domain/ticket-sales";
import { getPeruWallClock } from "@/lib/domain/trip-availability";
import { ticketHistoryQuerySchema } from "@/lib/validation/schemas";

vi.mock("server-only", () => ({}));
import { listTicketHistory } from "@/server/data/operations";

const operator: SessionUser = {
  id: "U003", username: "operador", nombres: "Operador", apellidos: "Agencia",
  rol: "OPERADOR", dni: "12345678", conductorId: null,
  agenciaId: "A01", agenciaNombre: "Ayacucho", mustChangePassword: false,
};

describe("ventas del día", () => {
  const tickets = [
    { codigo: "B001", fechaEmision: "2026-09-16 23:59", id_viaje: "T001" },
    { codigo: "B002", fechaEmision: "2026-09-17 00:00", id_viaje: "T001" },
    { codigo: "B003", fechaEmision: "2026-09-17 12:00", id_viaje: "T002", estado: "anulado" },
    { codigo: "B004", fechaEmision: "2026-09-18 00:00", id_viaje: "T003" },
  ] as Boleto[];

  it("muestra ventas por emisión, incluidas las anuladas, sin mezclar días ni mutar la lista", () => {
    expect(ticketsSoldOn(tickets, "2026-09-17").map((item) => item.codigo)).toEqual(["B003", "B002"]);
    expect(tickets[0].codigo).toBe("B001");
  });

  it("usa el día de Perú aunque UTC ya esté en el día siguiente", () => {
    const date = getPeruWallClock(new Date("2026-09-18T04:59:00Z")).date;
    expect(date).toBe("2026-09-17");
    expect(ticketsSoldOn(tickets, date)).toHaveLength(2);
    expect(getPeruWallClock(new Date("2026-09-18T05:00:00Z")).date).toBe("2026-09-18");
  });
});

describe("validación del historial", () => {
  it("rechaza rangos invertidos, fechas imposibles, estados y páginas inválidas", () => {
    for (const input of [
      { from: "2026-09-18", to: "2026-09-17" }, { from: "2026-02-30" },
      { state: "otro" }, { page: 0 }, { page: "NaN" },
    ]) expect(ticketHistoryQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe("historial de boletos y alcance de agencia", () => {
  const previousPool = globalThis.__econnvraePool;
  const poolQuery = vi.fn();
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockResolvedValueOnce({ rows: [{ total: "45" }], rowCount: 1 });
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    globalThis.__econnvraePool = { query: poolQuery } as never;
  });
  afterEach(() => { globalThis.__econnvraePool = previousPool; });

  it("permite al operador consultar ventas anteriores solo de su agencia y con paginación", async () => {
    const result = await listTicketHistory(operator, ticketHistoryQuerySchema.parse({
      search: "María", from: "2026-08-01", to: "2026-08-31", state: "anulado", page: 2,
    }));
    expect(result).toMatchObject({ total: 45, page: 2, pageSize: 20 });
    const [sql, params] = poolQuery.mock.calls[1];
    expect(params).toEqual([1, "María", "2026-08-01", "2026-08-31", "ANULADO", 20, 20]);
    expect(sql).toContain("v.id_agencia = $1");
    expect(sql).toContain("America/Lima");
    expect(sql).toContain("ORDER BY b.fecha_emision DESC, b.id_boleto DESC");
    expect(sql).not.toContain("DATE_TRUNC('day', NOW()");
  });

  it("rechaza conductores y operadores sin una agencia válida antes de consultar", async () => {
    const filters = ticketHistoryQuerySchema.parse({});
    await expect(listTicketHistory({ ...operator, rol: "CONDUCTOR" }, filters)).rejects.toMatchObject({ status: 403 });
    await expect(listTicketHistory({ ...operator, agenciaId: null }, filters)).rejects.toMatchObject({ status: 403 });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("respeta el alcance global del superadministrador y ajusta páginas fuera de rango", async () => {
    const result = await listTicketHistory({ ...operator, rol: "SUPER_ADMIN" }, ticketHistoryQuerySchema.parse({ page: 99 }));
    expect(result.page).toBe(3);
    expect(poolQuery.mock.calls[1][1]).toEqual([null, "", "", "", "", 20, 40]);
  });
});

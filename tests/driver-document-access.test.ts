import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));

import {
  getOperationalDocumentFile,
  listDriverDocumentVehicleIds,
  listDriverOperationalDocuments,
  uploadDriverOperationalDocument,
} from "@/server/admin/documents";

const driver: SessionUser = {
  id: "U007",
  username: "conductor",
  nombres: "Conductor",
  apellidos: "Prueba",
  rol: "CONDUCTOR",
  dni: "12345678",
  conductorId: "C02",
  agenciaId: "A001",
  agenciaNombre: "Ayacucho",
  mustChangePassword: false,
};

const contents = Buffer.from("%PDF-1.7\nDOCUMENT_TEST");
const baseFile = {
  id_agencia: 1,
  id_conductor: 2 as number | null,
  id_vehiculo: null as number | null,
  archivo_nombre: "documento.pdf",
  archivo_mime: "application/pdf",
  archivo_contenido: contents,
};

describe("alcance de los documentos del conductor", () => {
  const previousPool = globalThis.__econnvraePool;
  const poolQuery = vi.fn();
  const transactionQuery = vi.fn();
  const release = vi.fn();
  const connect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockReset();
    transactionQuery.mockReset();
    connect.mockResolvedValue({ query: transactionQuery, release });
    globalThis.__econnvraePool = { query: poolQuery, connect } as never;
  });

  afterEach(() => {
    globalThis.__econnvraePool = previousPool;
  });

  function expectCurrentAssignment(sql: string) {
    expect(sql).toContain("trip.estado IN ('PROGRAMADO', 'EN_CURSO')");
    expect(sql).toContain("trip.estado = 'EN_CURSO' OR trip.fecha_hora_salida > NOW()");
    expect(sql).not.toContain("creado_por");
  }

  it("limita las opciones de vehículo a la agencia y asignaciones vigentes usando el reloj de la BD", async () => {
    poolQuery.mockResolvedValue({ rows: [{ id_vehiculo: 4 }], rowCount: 1 });
    await expect(listDriverDocumentVehicleIds(driver)).resolves.toEqual(["V04"]);
    const [sql, values] = poolQuery.mock.calls[0];
    expect(values).toEqual([1, 2]);
    expect(sql).toContain("vehicle.id_agencia_base = $1");
    expect(sql).toContain("trip.id_conductor = $2");
    expectCurrentAssignment(sql);
  });

  it("el listado no mantiene acceso a vehículos por haber subido un archivo en el pasado", async () => {
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(listDriverOperationalDocuments(driver)).resolves.toEqual([]);
    const [sql, values] = poolQuery.mock.calls[0];
    expect(values).toEqual([1, 2]);
    expect(sql).toContain("document.id_agencia = $1");
    expect(sql).toContain("document.id_conductor = $2");
    expectCurrentAssignment(sql);
  });

  it.each([
    { conductorId: null },
    { agenciaId: null },
    { conductorId: "C00" },
  ])("rechaza perfiles incompletos antes de consultar opciones", async (override) => {
    await expect(listDriverDocumentVehicleIds({ ...driver, ...override }))
      .rejects.toMatchObject({ status: 403 });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("permite visualizar y descargar el documento propio", async () => {
    poolQuery.mockResolvedValue({ rows: [baseFile], rowCount: 1 });
    await expect(getOperationalDocumentFile(driver, "DOC001")).resolves.toEqual({
      name: "documento.pdf", mimeType: "application/pdf", contents,
    });
    expect(poolQuery).toHaveBeenCalledOnce();
  });

  it("rechaza los documentos de otro conductor aunque pertenezca a la misma agencia", async () => {
    poolQuery.mockResolvedValue({ rows: [{ ...baseFile, id_conductor: 3 }], rowCount: 1 });
    await expect(getOperationalDocumentFile(driver, "DOC001"))
      .rejects.toMatchObject({ status: 403 });
  });

  it("no confunde un conductor sin perfil con un documento cuyo conductor es NULL", async () => {
    poolQuery.mockResolvedValue({ rows: [{ ...baseFile, id_conductor: null, id_vehiculo: 4 }], rowCount: 1 });
    await expect(getOperationalDocumentFile({ ...driver, conductorId: null }, "DOC001"))
      .rejects.toMatchObject({ status: 403 });
    expect(poolQuery).toHaveBeenCalledOnce();
  });

  it("no permite abrir un archivo propio fuera de la agencia activa", async () => {
    poolQuery.mockResolvedValue({ rows: [{ ...baseFile, id_agencia: 3 }], rowCount: 1 });
    await expect(getOperationalDocumentFile(driver, "DOC001"))
      .rejects.toMatchObject({ status: 403 });
  });

  it.each([true, false])("el acceso al archivo del vehículo exige asignación vigente: %s", async (assigned) => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ ...baseFile, id_conductor: null, id_vehiculo: 4 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: assigned ? [{}] : [], rowCount: assigned ? 1 : 0 });
    const request = getOperationalDocumentFile(driver, "DOC001");
    if (assigned) {
      await expect(request).resolves.toMatchObject({ contents });
    } else {
      await expect(request).rejects.toMatchObject({ status: 403 });
    }
    const [sql, values] = poolQuery.mock.calls[1];
    expect(values).toEqual([4, 2]);
    expectCurrentAssignment(sql);
  });

  it("el superadministrador mantiene acceso global sin agencia seleccionada", async () => {
    poolQuery.mockResolvedValue({ rows: [{ ...baseFile, id_agencia: 3 }], rowCount: 1 });
    await expect(getOperationalDocumentFile({ ...driver, rol: "SUPER_ADMIN", conductorId: null, agenciaId: null }, "DOC001"))
      .resolves.toMatchObject({ contents });
  });

  it.each([1, 3])("el administrador solo visualiza archivos de su agencia: %s", async (agencyId) => {
    poolQuery.mockResolvedValue({ rows: [{ ...baseFile, id_agencia: agencyId }], rowCount: 1 });
    const request = getOperationalDocumentFile({ ...driver, rol: "ADMINISTRADOR", conductorId: null }, "DOC001");
    if (agencyId === 1) {
      await expect(request).resolves.toMatchObject({ contents });
    } else {
      await expect(request).rejects.toMatchObject({ status: 403 });
    }
  });

  it("el operador no puede visualizar documentación de conductores", async () => {
    poolQuery.mockResolvedValue({ rows: [baseFile], rowCount: 1 });
    await expect(getOperationalDocumentFile({ ...driver, rol: "OPERADOR", conductorId: null }, "DOC001"))
      .rejects.toMatchObject({ status: 403 });
  });

  it("rechaza renovar documentos de un vehículo sin asignación vigente y no inserta archivos", async () => {
    transactionQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(uploadDriverOperationalDocument(driver, {
      documentType: "SOAT", vehicleId: "V04", number: "SOAT-TEST",
      issuedAt: "2026-01-01", expiresAt: "2027-01-01", notes: "",
    }, {
      name: "documento.pdf", mimeType: "application/pdf", size: contents.length,
      sha256: "a".repeat(64), contents,
    })).rejects.toMatchObject({ status: 403 });
    const [sql, values] = transactionQuery.mock.calls[1];
    expect(values).toEqual([4, 1, 2]);
    expectCurrentAssignment(sql);
    expect(transactionQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(transactionQuery).toHaveBeenLastCalledWith("ROLLBACK");
    expect(transactionQuery.mock.calls.some(([statement]) => statement.includes("INSERT"))).toBe(false);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});

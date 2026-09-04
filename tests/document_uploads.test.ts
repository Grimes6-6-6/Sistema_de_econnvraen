import { describe, expect, it } from "vitest";
import {
  driverOperationalDocumentSchema,
  driverIdentityReviewSchema,
  operationalDocumentReviewSchema,
  operationalDocumentSchema,
} from "@/lib/validation/schemas";
import {
  detectDocumentMime,
  sanitizeDocumentFilename,
} from "@/lib/security/document-files";

describe("archivos documentarios del conductor", () => {
  it.each([
    [[0x25, 0x50, 0x44, 0x46, 0x2d], "application/pdf"],
    [[0xff, 0xd8, 0xff, 0xe0], "image/jpeg"],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
    [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], "image/webp"],
  ])("detecta la firma real de un archivo permitido", (signature, expected) => {
    expect(detectDocumentMime(new Uint8Array(signature as number[]))).toBe(expected);
  });

  it("rechaza contenido ejecutable o SVG aunque cambien su extensión", () => {
    expect(detectDocumentMime(new TextEncoder().encode("<svg><script/></svg>"))).toBeNull();
    expect(detectDocumentMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });

  it("elimina rutas y caracteres peligrosos del nombre", () => {
    expect(sanitizeDocumentFilename("../../licencia\u0000<script>.pdf")).toBe(
      "licencia_script_.pdf",
    );
  });
});

describe("datos documentarios del conductor", () => {
  const base = {
    number: "LIC-12345",
    issuedAt: "2026-01-01",
    expiresAt: "2027-01-01",
    notes: "Documento renovado",
  };

  it("permite una licencia propia sin vehículo", () => {
    expect(driverOperationalDocumentSchema.safeParse({
      ...base,
      documentType: "LICENCIA",
      vehicleId: "",
    }).success).toBe(true);
  });

  it("permite registrar el DNI únicamente como documento del conductor", () => {
    expect(driverOperationalDocumentSchema.safeParse({
      ...base,
      documentType: "DNI",
      number: "12345678",
      vehicleId: "",
    }).success).toBe(true);
    expect(operationalDocumentSchema.safeParse({
      ...base,
      holderType: "VEHICULO",
      holderId: "V01",
      documentType: "DNI",
      number: "12345678",
      state: "VIGENTE",
    }).success).toBe(false);
  });

  it("rechaza un número de DNI que no tenga exactamente 8 dígitos", () => {
    expect(driverOperationalDocumentSchema.safeParse({
      ...base,
      documentType: "DNI",
      number: "1234ABCD",
      vehicleId: "",
    }).success).toBe(false);
  });

  it("exige un vehículo para SOAT, CITV, TUC y tarjeta de propiedad", () => {
    expect(driverOperationalDocumentSchema.safeParse({
      ...base,
      documentType: "SOAT",
      vehicleId: "",
    }).success).toBe(false);
    expect(driverOperationalDocumentSchema.safeParse({
      ...base,
      documentType: "SOAT",
      vehicleId: "V01",
    }).success).toBe(true);
  });

  it("rechaza una fecha de vencimiento anterior a la emisión", () => {
    expect(driverOperationalDocumentSchema.safeParse({
      ...base,
      documentType: "LICENCIA",
      issuedAt: "2027-01-01",
      expiresAt: "2026-01-01",
    }).success).toBe(false);
  });

  it("exige motivo cuando administración observa el documento", () => {
    expect(operationalDocumentReviewSchema.safeParse({
      decision: "OBSERVAR",
      reason: "",
    }).success).toBe(false);
    expect(operationalDocumentReviewSchema.safeParse({
      decision: "APROBAR",
      reason: "",
    }).success).toBe(true);
  });

  it("exige motivo cuando el superadministrador observa la identidad", () => {
    expect(driverIdentityReviewSchema.safeParse({
      decision: "OBSERVAR",
      reason: "",
    }).success).toBe(false);
    expect(driverIdentityReviewSchema.safeParse({
      decision: "VERIFICAR",
      reason: "",
    }).success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { canAdvanceParcelStatus } from "@/lib/domain/rules";

describe("transiciones de encomienda", () => {
  it("solo avanza por el flujo permitido", () => {
    expect(canAdvanceParcelStatus("registrado", "en_transito")).toBe(true);
    expect(canAdvanceParcelStatus("en_transito", "en_destino")).toBe(true);
    expect(canAdvanceParcelStatus("en_destino", "entregado")).toBe(true);
  });

  it("rechaza retrocesos y saltos de estado", () => {
    expect(canAdvanceParcelStatus("entregado", "en_transito")).toBe(false);
    expect(canAdvanceParcelStatus("registrado", "entregado")).toBe(false);
    expect(canAdvanceParcelStatus("recojo_domicilio", "registrado")).toBe(false);
  });
});

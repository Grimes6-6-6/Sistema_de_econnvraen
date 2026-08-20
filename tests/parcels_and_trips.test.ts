import { describe, expect, it } from "vitest";
import { canAdvanceParcelStatus } from "@/lib/domain/rules";
import { parcelStatusSchema } from "@/lib/validation/schemas";

describe("Reglas de Negocio de Encomiendas y Viajes (OWASP A08)", () => {
  it("Valida la máquina de estados estricta de encomiendas", () => {
    // Transiciones válidas
    expect(canAdvanceParcelStatus("registrado", "en_transito")).toBe(true);
    expect(canAdvanceParcelStatus("recojo_domicilio", "en_transito")).toBe(true);
    expect(canAdvanceParcelStatus("en_transito", "en_destino")).toBe(true);
    expect(canAdvanceParcelStatus("en_destino", "entregado")).toBe(true);

    // Transiciones prohibidas (saltos directos o retrocesos)
    expect(canAdvanceParcelStatus("registrado", "entregado")).toBe(false);
    expect(canAdvanceParcelStatus("en_transito", "registrado")).toBe(false);
    expect(canAdvanceParcelStatus("entregado", "en_transito")).toBe(false);
  });

  it("Exige firma obligatoria cuando el nuevo estado es 'entregado'", () => {
    // 'entregado' sin firma -> debe fallar validación
    expect(() =>
      parcelStatusSchema.parse({
        requestId: "00000000-0000-0000-0000-000000000000",
        newState: "entregado",
        location: "Agencia San Francisco",
        evidence: null,
      }),
    ).toThrow();

    // 'entregado' con firma válida -> pasa
    const valid = parcelStatusSchema.parse({
      requestId: "11111111-1111-4111-8111-111111111111",
      newState: "entregado",
      location: "Agencia San Francisco",
      evidence: {
        signature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        photo: "Foto entrega",
      },
    });
    expect(valid.newState).toBe("entregado");
    expect(valid.evidence?.signature).toBeDefined();
  });

  it("Permite estados intermedios sin firma obligatoria", () => {
    const valid = parcelStatusSchema.parse({
      requestId: "22222222-2222-4222-8222-222222222222",
      newState: "en_transito",
      location: "En ruta Ayacucho - VRAEM",
    });
    expect(valid.newState).toBe("en_transito");
  });
});

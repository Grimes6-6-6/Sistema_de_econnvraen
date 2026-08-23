import { describe, expect, it } from "vitest";
import { parseEntityId, formatEntityId } from "@/lib/domain/ids";
import { driverProfileUpdateSchema } from "@/lib/validation/schemas";

describe("Seguridad y Control de Acceso (OWASP A01 & A07)", () => {
  it("Valida parsing estricto de IDs de entidades para evitar IDOR", () => {
    expect(parseEntityId("T001", "T")).toBe(1);
    expect(parseEntityId("T15", "T")).toBe(15);
    expect(parseEntityId("C02", "C")).toBe(2);
    expect(parseEntityId("E005", "E")).toBe(5);

    // Formatos inválidos o inyecciones
    expect(parseEntityId("T99999999999999", "T")).toBeNull();
    expect(parseEntityId("T-1", "T")).toBeNull();
    expect(parseEntityId("T1; DROP TABLE viajes;", "T")).toBeNull();
    expect(parseEntityId("C01", "T")).toBeNull(); // Mismatch de prefijo
  });

  it("Formatea IDs con prefijos canónicos y relleno de ceros", () => {
    expect(formatEntityId("T", 1, 3)).toBe("T001");
    expect(formatEntityId("C", 2, 2)).toBe("C02");
    expect(formatEntityId("A", 1, 2)).toBe("A01");
    expect(formatEntityId("INC", 5, 3)).toBe("INC005");
  });

  it("Esquema de actualización de perfil de conductor restringe campos y valida formatos", () => {
    const valid = driverProfileUpdateSchema.parse({
      phone: "987654321",
      email: "conductor@econnvrae.pe",
      address: "Jr. Los Andes 245, Ayacucho",
    });
    expect(valid.phone).toBe("987654321");
    expect(valid.email).toBe("conductor@econnvrae.pe");

    // Teléfono inválido
    expect(() =>
      driverProfileUpdateSchema.parse({
        phone: "abc123",
      }),
    ).toThrow();

    // Email inválido
    expect(() =>
      driverProfileUpdateSchema.parse({
        email: "correo-invalido",
      }),
    ).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { tripIncidentSchema } from "@/lib/validation/schemas";

describe("Validación de Incidencias de Viajes (OWASP A06 & A08)", () => {
  it("Acepta incidencias válidas con todos los tipos soportados", () => {
    const tipos = [
      "MECANICA",
      "CLIMA",
      "BLOQUEO_VIA",
      "ACCIDENTE",
      "RETRASO",
      "OTRO",
    ] as const;

    for (const tipo of tipos) {
      const parsed = tripIncidentSchema.parse({
        tipo,
        descripcion: "Falla mecánica en neumático trasero derecho en km 45",
        nivel_gravedad: "MODERADA",
        latitude: -12.9345,
        longitude: -74.2234,
      });
      expect(parsed.tipo).toBe(tipo);
      expect(parsed.nivel_gravedad).toBe("MODERADA");
      expect(parsed.latitude).toBeCloseTo(-12.9345);
    }
  });

  it("Acepta nivel de gravedad por defecto LEVE", () => {
    const parsed = tripIncidentSchema.parse({
      tipo: "CLIMA",
      descripcion: "Lluvia intensa con baja visibilidad en la cordillera",
    });
    expect(parsed.nivel_gravedad).toBe("LEVE");
    expect(parsed.latitude).toBeUndefined();
  });

  it("Rechaza descripciones menores a 5 caracteres o vacías", () => {
    expect(() =>
      tripIncidentSchema.parse({
        tipo: "MECANICA",
        descripcion: "F",
      }),
    ).toThrow();
  });

  it("Rechaza coordenadas fuera de los rangos geográficos válidos", () => {
    // Latitud fuera de [-90, 90]
    expect(() =>
      tripIncidentSchema.parse({
        tipo: "MECANICA",
        descripcion: "Falla mecánica en ruta",
        latitude: 95.0,
      }),
    ).toThrow();

    // Longitud fuera de [-180, 180]
    expect(() =>
      tripIncidentSchema.parse({
        tipo: "MECANICA",
        descripcion: "Falla mecánica en ruta",
        longitude: -190.0,
      }),
    ).toThrow();
  });

  it("Rechaza tipos de incidencia no reconocidos", () => {
    expect(() =>
      tripIncidentSchema.parse({
        tipo: "TIPO_INEXISTENTE" as any,
        descripcion: "Descripción de prueba para incidencia",
      }),
    ).toThrow();
  });
});

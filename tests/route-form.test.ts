import { describe, expect, it } from "vitest";
import { getRouteFormAgencyOptions } from "@/lib/domain/route-form";
import { managedRouteSchema } from "@/lib/validation/schemas";

const agencies = [
  { id: "A01", city: "Ayacucho" },
  { id: "A02", city: "Kimbiri" },
  { id: "A03", city: "Pichari" },
];

describe("agencias del formulario de rutas", () => {
  it("limita el origen del administrador a su agencia activa", () => {
    const options = getRouteFormAgencyOptions(agencies, {
      role: "ADMINISTRADOR", activeAgencyId: "A02", originAgencyId: "A03", destinationAgencyId: "A01",
    });
    expect(options.origins.map((agency) => agency.id)).toEqual(["A02"]);
    expect(options.originAgencyId).toBe("A02");
    expect(options.destinationAgencyId).toBe("A01");
  });

  it("permite al superadmin crear una ruta hacia su agencia activa", () => {
    const options = getRouteFormAgencyOptions(agencies, {
      role: "SUPER_ADMIN", activeAgencyId: "A01", originAgencyId: "A02", destinationAgencyId: "A01",
    });
    expect(options.origins).toEqual(agencies);
    expect(options.destinations.map((agency) => agency.id)).toEqual(["A01", "A03"]);
    expect(options.destinationAgencyId).toBe("A01");
  });

  it("elimina el destino anterior cuando pasa a ser el nuevo origen", () => {
    const options = getRouteFormAgencyOptions(agencies, {
      role: "SUPER_ADMIN", activeAgencyId: "A01", originAgencyId: "A03", destinationAgencyId: "A03",
    });
    expect(options.destinations.map((agency) => agency.id)).toEqual(["A01", "A02"]);
    expect(options.destinationAgencyId).toBe("");
  });

  it("no ofrece otra agencia como origen si la agencia del administrador no está activa", () => {
    const options = getRouteFormAgencyOptions(agencies, {
      role: "ADMINISTRADOR", activeAgencyId: "A04", originAgencyId: "A01", destinationAgencyId: "A02",
    });
    expect(options.origins).toEqual([]);
    expect(options.destinations).toEqual([]);
    expect(options.originAgencyId).toBe("");
    expect(options.destinationAgencyId).toBe("");
  });

  it("no inventa un destino cuando solo hay una agencia activa", () => {
    const options = getRouteFormAgencyOptions(agencies.slice(0, 1), {
      role: "SUPER_ADMIN", activeAgencyId: "A01", originAgencyId: "", destinationAgencyId: "A02",
    });
    expect(options.originAgencyId).toBe("A01");
    expect(options.destinations).toEqual([]);
    expect(options.destinationAgencyId).toBe("");
  });
});

describe("validación del formulario de rutas", () => {
  const input = {
    originAgencyId: "A01", destinationAgencyId: "A02", distanceKm: 135.25, durationHours: 4.5, price: 59.99,
  };

  it("acepta precios con centavos", () => {
    expect(managedRouteSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    { distanceKm: 0 }, { distanceKm: 5000.01 },
    { durationHours: 0 }, { durationHours: 100.01 },
    { price: -0.01 }, { price: 100000.01 },
    { destinationAgencyId: "A01" },
  ])("rechaza datos fuera de las reglas: %j", (change) => {
    expect(managedRouteSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
});

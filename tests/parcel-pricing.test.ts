import { describe, expect, it } from "vitest";
import {
  calculateParcelPrice,
  parseParcelDimensions,
} from "@/lib/domain/parcel-pricing";

describe("tarifario de encomiendas", () => {
  it("cobra el peso real cuando supera al peso volumétrico", () => {
    const quote = calculateParcelPrice({
      distanceKm: 120,
      actualWeightKg: 2,
      dimensions: "20 x 20 x 20",
      declaredValue: 0,
    });

    expect(quote).toMatchObject({
      volumetricWeightKg: 1.6,
      chargeableWeightKg: 2,
      total: 13,
    });
  });

  it("cobra el peso volumétrico cuando el paquete ocupa más espacio", () => {
    const quote = calculateParcelPrice({
      distanceKm: 120,
      actualWeightKg: 1,
      dimensions: "60x40x40",
      declaredValue: 0,
    });

    expect(quote).toMatchObject({
      volumetricWeightKg: 19.2,
      chargeableWeightKg: 19.2,
      total: 47,
    });
  });

  it("incluye la distancia y la protección del valor declarado", () => {
    const quote = calculateParcelPrice({
      distanceKm: 300,
      actualWeightKg: 2,
      dimensions: "20 × 20 × 20",
      declaredValue: 1_000,
    });

    expect(quote).toMatchObject({
      distanceFee: 9,
      protectionFee: 5,
      total: 23,
    });
  });

  it("rechaza dimensiones incompletas o fuera de rango", () => {
    expect(parseParcelDimensions("30 x 20")).toBeNull();
    expect(parseParcelDimensions("600 x 20 x 20")).toBeNull();
    expect(parseParcelDimensions("30,5 x 20 x 15")).toEqual({
      lengthCm: 30.5,
      widthCm: 20,
      heightCm: 15,
    });
  });
});

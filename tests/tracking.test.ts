import { describe, expect, it } from "vitest";
import {
  createTrackingCode,
  hasValidTrackingChecksum,
} from "@/lib/domain/tracking";

describe("códigos de seguimiento", () => {
  it("usa la fecha de Lima y genera un dígito de control verificable", () => {
    const code = createTrackingCode(
      42,
      new Date("2026-07-15T03:30:00.000Z"),
    );
    expect(code).toMatch(/^ECV-260714-0042\d$/);
    expect(hasValidTrackingChecksum(code)).toBe(true);
  });

  it("rechaza alteraciones del dígito de control y IDs inválidos", () => {
    const code = createTrackingCode(9, new Date("2026-07-14T12:00:00.000Z"));
    const alteredDigit = code.endsWith("9") ? "8" : "9";
    expect(hasValidTrackingChecksum(`${code.slice(0, -1)}${alteredDigit}`)).toBe(false);
    expect(() => createTrackingCode(0)).toThrow("INVALID_PARCEL_ID");
  });
});

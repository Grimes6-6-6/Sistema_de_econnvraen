import { describe, expect, it } from "vitest";
import {
  buildParcelTrackingUrl,
  extractParcelTrackingCode,
  maskDni,
} from "@/lib/domain/parcel-receipt";

describe("recibo de encomienda", () => {
  it("crea un enlace público con el tracking sin incluir el DNI", () => {
    const url = buildParcelTrackingUrl(
      "https://econnvrae-next.vercel.app",
      "ecv-260823-00001",
    );

    expect(url).toBe(
      "https://econnvrae-next.vercel.app/public?tracking=ECV-260823-00001",
    );
    expect(url).not.toContain("1234");
  });

  it("enmascara el DNI para el recibo impreso", () => {
    expect(maskDni("76729940")).toBe("••••9940");
  });

  it("rechaza códigos de tracking manipulados", () => {
    expect(() =>
      buildParcelTrackingUrl("https://example.com", "<script>"),
    ).toThrow("INVALID_TRACKING_CODE");
  });

  it("extrae el código desde el QR del recibo", () => {
    expect(
      extractParcelTrackingCode(
        "https://econnvrae-next.vercel.app/public?tracking=ECV-260823-00001",
      ),
    ).toBe("ECV-260823-00001");
    expect(extractParcelTrackingCode("ecv-260823-00001")).toBe(
      "ECV-260823-00001",
    );
  });

  it("ignora QR que no pertenecen al formato de seguimiento", () => {
    expect(extractParcelTrackingCode("https://example.com/phishing")).toBeNull();
    expect(
      extractParcelTrackingCode(
        "https://example.com/public?tracking=<script>",
      ),
    ).toBeNull();
  });
});

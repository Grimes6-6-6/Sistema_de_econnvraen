import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  maskMobile,
  normalizePeruMobile,
  sendSmsOtp,
  SmsProviderError,
} from "@/server/auth/sms-provider";

describe("autenticación por SMS", () => {
  beforeEach(() => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", `AC${"1".repeat(32)}`);
    vi.stubEnv("TWILIO_API_KEY_SID", `SK${"2".repeat(32)}`);
    vi.stubEnv("TWILIO_API_KEY_SECRET", "secret-value-for-tests");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+17372508034");
    vi.stubEnv("TWILIO_SMS_TRIAL_TEMPLATE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("normaliza únicamente celulares peruanos válidos", () => {
    expect(normalizePeruMobile("973 187 642")).toBe("+51973187642");
    expect(normalizePeruMobile("+51973187642")).toBe("+51973187642");
    expect(normalizePeruMobile("123456789")).toBeNull();
  });

  it("solo muestra los últimos tres dígitos", () => {
    expect(maskMobile("+51973187642")).toBe("+51 ••• ••• 642");
  });

  it("recupera el código generado por la plantilla gratuita sin exponer credenciales", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            sid: `SM${"3".repeat(32)}`,
            status: "queued",
            body: "Your verification code is 654321. It expires in 5 minutes.",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(sendSmsOtp("+51973187642")).resolves.toEqual({
      code: "654321",
      messageSid: `SM${"3".repeat(32)}`,
    });
  });

  it("convierte el error del proveedor en un error controlado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 21_611, message: "Rejected" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(sendSmsOtp("+51973187642")).rejects.toMatchObject({
      name: "SmsProviderError",
      providerCode: 21_611,
    } satisfies Partial<SmsProviderError>);
  });
});

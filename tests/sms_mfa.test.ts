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
    vi.stubEnv("SMS_PROVIDER", "TWILIO");
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
      provider: "TWILIO",
    });
  });

  it("envía el código mediante el gateway Android de TextBee", async () => {
    vi.stubEnv("SMS_PROVIDER", "TEXTBEE");
    vi.stubEnv("TEXTBEE_API_KEY", "textbee-api-key-for-tests");
    vi.stubEnv("TEXTBEE_DEVICE_ID", "test-device-id");
    vi.stubEnv("TEXTBEE_SIM_SUBSCRIPTION_ID", "1");
    let requestBody: Record<string, unknown> | null = null;
    let requestMessage = "";
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestMessage = String(requestBody.message);
      return new Response(
        JSON.stringify({
          data: {
            success: true,
            smsBatchId: "textbee-batch-123",
            recipientCount: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSmsOtp("+51973187642");

    expect(result).toMatchObject({
      messageSid: "textbee-batch-123",
      provider: "TEXTBEE",
    });
    expect(result.code).toMatch(/^\d{6}$/);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.textbee.dev/api/v1/gateway/send-sms",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(requestBody).toMatchObject({
      recipients: ["+51973187642"],
      deviceId: "test-device-id",
      simSubscriptionId: 1,
    });
    expect(requestMessage).toContain(result.code);
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

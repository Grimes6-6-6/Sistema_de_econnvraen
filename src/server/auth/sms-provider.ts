import "server-only";

import { randomInt } from "node:crypto";

const PERU_MOBILE = /^9\d{8}$/;
const E164_PERU_MOBILE = /^\+519\d{8}$/;
const TWILIO_TRIAL_TEMPLATE = "sms_2fa";
const TEXTBEE_SEND_URL = "https://api.textbee.dev/api/v1/gateway/send-sms";

export type SmsProviderName = "TEXTBEE" | "TWILIO";

interface SmsSendResult {
  code: string;
  messageSid: string;
  provider: SmsProviderName;
}

interface TwilioMessageResponse {
  sid?: string;
  status?: string;
  body?: string;
  code?: number;
  message?: string;
}

interface TextbeeSendResponse {
  data?: {
    success?: boolean;
    message?: string;
    smsBatchId?: string;
    recipientCount?: number;
    successCount?: number;
    failureCount?: number;
    warning?: {
      code?: string;
      message?: string;
    };
  };
  message?: string;
}

export class SmsProviderError extends Error {
  constructor(
    public readonly providerCode: number | null = null,
    public readonly httpStatus: number | null = null,
    public readonly failureKind: "NETWORK" | "REJECTED" | "INVALID_RESPONSE" = "REJECTED",
    public readonly provider: SmsProviderName | null = null,
  ) {
    super("SMS_PROVIDER_ERROR");
    this.name = "SmsProviderError";
  }
}

function resolveProvider(): SmsProviderName {
  const configured = process.env.SMS_PROVIDER?.trim().toUpperCase();
  if (configured === "TEXTBEE" || configured === "TWILIO") return configured;
  if (configured) throw new Error("SMS_PROVIDER_INVALID");
  return process.env.TEXTBEE_API_KEY?.trim() ? "TEXTBEE" : "TWILIO";
}

function readTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();

  if (!accountSid || !apiKeySid || !apiKeySecret || !fromNumber) {
    throw new Error("SMS_PROVIDER_NOT_CONFIGURED");
  }
  if (!/^AC[a-f0-9]{32}$/i.test(accountSid)) {
    throw new Error("TWILIO_ACCOUNT_SID_INVALID");
  }
  if (!/^SK[a-f0-9]{32}$/i.test(apiKeySid)) {
    throw new Error("TWILIO_API_KEY_SID_INVALID");
  }
  if (!/^\+[1-9]\d{7,14}$/.test(fromNumber)) {
    throw new Error("TWILIO_FROM_NUMBER_INVALID");
  }

  return { accountSid, apiKeySid, apiKeySecret, fromNumber };
}

function readTextbeeConfig() {
  const apiKey = process.env.TEXTBEE_API_KEY?.trim();
  const deviceId = process.env.TEXTBEE_DEVICE_ID?.trim();
  const rawSimSubscriptionId = process.env.TEXTBEE_SIM_SUBSCRIPTION_ID?.trim();

  if (!apiKey) throw new Error("SMS_PROVIDER_NOT_CONFIGURED");

  let simSubscriptionId: number | undefined;
  if (rawSimSubscriptionId) {
    simSubscriptionId = Number(rawSimSubscriptionId);
    if (!Number.isInteger(simSubscriptionId) || simSubscriptionId < 0) {
      throw new Error("TEXTBEE_SIM_SUBSCRIPTION_ID_INVALID");
    }
  }

  return { apiKey, deviceId: deviceId || undefined, simSubscriptionId };
}

export function isSmsProviderConfigured(): boolean {
  try {
    const provider = resolveProvider();
    if (provider === "TEXTBEE") readTextbeeConfig();
    else readTwilioConfig();
    return true;
  } catch {
    return false;
  }
}

export function normalizePeruMobile(phone: string | null | undefined): string | null {
  const compact = (phone || "").replace(/[\s()-]/g, "");
  if (PERU_MOBILE.test(compact)) return `+51${compact}`;
  if (E164_PERU_MOBILE.test(compact)) return compact;
  return null;
}

export function maskMobile(phone: string): string {
  return `+51 ••• ••• ${phone.slice(-3)}`;
}

function extractTrialCode(messageBody: string | undefined): string | null {
  return messageBody?.match(/verification code is\s+(\d{6})/i)?.[1] || null;
}

async function sendTextbeeSmsOtp(phone: string): Promise<SmsSendResult> {
  const config = readTextbeeConfig();
  const generatedCode = String(randomInt(100_000, 1_000_000));
  const body: Record<string, unknown> = {
    message: `ECONNVRAE: tu código de acceso es ${generatedCode}. Vence en 5 minutos. No lo compartas.`,
    recipients: [phone],
  };
  if (config.deviceId) body.deviceId = config.deviceId;
  if (config.simSubscriptionId !== undefined) {
    body.simSubscriptionId = config.simSubscriptionId;
  }

  let response: Response;
  try {
    response = await fetch(TEXTBEE_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("TextBee SMS request failed", {
      failureKind: "NETWORK",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new SmsProviderError(null, null, "NETWORK", "TEXTBEE");
  }

  const payload = (await response.json().catch(() => null)) as TextbeeSendResponse | null;
  const result = payload?.data;
  const successfulCount = result?.successCount || 0;
  const failedCount = result?.failureCount || 0;
  const accepted =
    result?.success === true || Boolean(result?.smsBatchId) || successfulCount > 0;
  if (
    !response.ok ||
    !result ||
    result.success === false ||
    (failedCount > 0 && successfulCount <= 0) ||
    !accepted
  ) {
    console.error("TextBee SMS request failed", {
      failureKind: "REJECTED",
      status: response.status,
      providerMessage: result?.message || payload?.message || null,
      warningCode: result?.warning?.code || null,
      successCount: successfulCount,
      failureCount: failedCount,
    });
    throw new SmsProviderError(null, response.status, "REJECTED", "TEXTBEE");
  }

  return {
    code: generatedCode,
    messageSid: result.smsBatchId || "textbee-accepted",
    provider: "TEXTBEE",
  };
}

async function sendTwilioSmsOtp(phone: string): Promise<SmsSendResult> {
  const config = readTwilioConfig();
  const trialMode = process.env.TWILIO_SMS_TRIAL_TEMPLATE === "true";
  const generatedCode = String(randomInt(100_000, 1_000_000));
  const messageBody = trialMode
    ? TWILIO_TRIAL_TEMPLATE
    : `ECONNVRAE: tu código de acceso es ${generatedCode}. Vence en 5 minutos. No lo compartas.`;
  const form = new URLSearchParams({
    To: phone,
    From: config.fromNumber,
    Body: messageBody,
  });
  const authorization = Buffer.from(
    `${config.apiKeySid}:${config.apiKeySecret}`,
  ).toString("base64");

  let response: Response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authorization}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new SmsProviderError(null, null, "NETWORK", "TWILIO");
  }

  const payload = (await response.json().catch(() => null)) as TwilioMessageResponse | null;
  if (!response.ok || !payload?.sid) {
    throw new SmsProviderError(
      payload?.code || null,
      response.status,
      "REJECTED",
      "TWILIO",
    );
  }

  const code = trialMode ? extractTrialCode(payload.body) : generatedCode;
  if (!code) {
    throw new SmsProviderError(null, response.status, "INVALID_RESPONSE", "TWILIO");
  }
  return { code, messageSid: payload.sid, provider: "TWILIO" };
}

export async function sendSmsOtp(phone: string): Promise<SmsSendResult> {
  return resolveProvider() === "TEXTBEE"
    ? sendTextbeeSmsOtp(phone)
    : sendTwilioSmsOtp(phone);
}

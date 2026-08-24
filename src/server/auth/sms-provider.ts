import "server-only";

import { randomInt } from "node:crypto";

const PERU_MOBILE = /^9\d{8}$/;
const E164_PERU_MOBILE = /^\+519\d{8}$/;
const TWILIO_TRIAL_TEMPLATE = "sms_2fa";

interface TwilioMessageResponse {
  sid?: string;
  status?: string;
  body?: string;
  code?: number;
  message?: string;
}

export class SmsProviderError extends Error {
  constructor(public readonly providerCode: number | null = null) {
    super("SMS_PROVIDER_ERROR");
    this.name = "SmsProviderError";
  }
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

export function isSmsProviderConfigured(): boolean {
  try {
    readTwilioConfig();
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

export async function sendSmsOtp(phone: string): Promise<{ code: string; messageSid: string }> {
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
    throw new SmsProviderError();
  }

  const payload = (await response.json().catch(() => null)) as TwilioMessageResponse | null;
  if (!response.ok || !payload?.sid) {
    throw new SmsProviderError(payload?.code || null);
  }

  const code = trialMode ? extractTrialCode(payload.body) : generatedCode;
  if (!code) throw new SmsProviderError();
  return { code, messageSid: payload.sid };
}

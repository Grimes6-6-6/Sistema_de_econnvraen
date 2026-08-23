import "server-only";

import { createHmac } from "node:crypto";

const DEVELOPMENT_PEPPER =
  "development-only-econnvrae-request-pepper-change-before-production";

function getHashPepper(): string {
  const configured = process.env.AUTH_HASH_PEPPER?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== "production") return DEVELOPMENT_PEPPER;
  throw new Error("AUTH_HASH_PEPPER_NOT_CONFIGURED");
}

export function getClientAddress(request: Request): string {
  if (process.env.TRUST_PROXY !== "true") {
    return "direct-client";
  }
  const forwardedFor = request.headers.get("x-forwarded-for");
  return (
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "proxy-client-unknown"
  );
}

export function hashPrivateValue(value: string): string {
  return createHmac("sha256", getHashPepper()).update(value).digest("hex");
}

export function getClientAddressHash(request: Request): string {
  return hashPrivateValue(getClientAddress(request));
}

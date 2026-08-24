import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_CONTEXT = "econnvrae:mfa:encryption:v1";
const RECOVERY_CONTEXT = "econnvrae:mfa:recovery:v1";

function masterKey(): Buffer {
  const encoded = process.env.MFA_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error("MFA_ENCRYPTION_KEY_NOT_CONFIGURED");

  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY_INVALID");
  return key;
}

function deriveKey(context: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey(), Buffer.alloc(0), context, 32),
  );
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(ENCRYPTION_CONTEXT), iv);
  cipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptMfaSecret(payload: string): string {
  const [version, ivValue, tagValue, ciphertextValue, extra] = payload.split(".");
  if (
    version !== ENCRYPTION_VERSION ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra
  ) {
    throw new Error("MFA_SECRET_INVALID");
  }

  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("MFA_SECRET_INVALID");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(ENCRYPTION_CONTEXT),
    iv,
  );
  decipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.replace(/[^A-Z2-9]/gi, "").toUpperCase();
  return createHmac("sha256", deriveKey(RECOVERY_CONTEXT))
    .update(normalized)
    .digest("hex");
}

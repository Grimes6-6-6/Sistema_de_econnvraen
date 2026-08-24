import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decryptMfaSecret,
  encryptMfaSecret,
  hashRecoveryCode,
} from "@/server/auth/mfa-crypto";

describe("protección de secretos MFA", () => {
  beforeEach(() => {
    vi.stubEnv(
      "MFA_ENCRYPTION_KEY",
      Buffer.alloc(32, 17).toString("base64url"),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cifra y recupera el secreto TOTP", () => {
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptMfaSecret(encrypted)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("rechaza un secreto cifrado que fue manipulado", () => {
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
    const parts = encrypted.split(".");
    parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
    const tampered = parts.join(".");
    expect(() => decryptMfaSecret(tampered)).toThrow();
  });

  it("normaliza los códigos de recuperación antes de protegerlos", () => {
    expect(hashRecoveryCode("ABCD-EFGH-JKLM")).toBe(
      hashRecoveryCode("abcdefghjklm"),
    );
  });
});

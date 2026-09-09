import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applicationBackupFormat,
  backupKeyFromHex,
  createApplicationBackup,
  openApplicationBackup,
  type ApplicationBackupSnapshot,
} from "@/lib/server/application-backup";

function fixture(): ApplicationBackupSnapshot {
  const { format, version } = applicationBackupFormat();
  return {
    format,
    version,
    createdAt: "2026-09-09T12:00:00.000Z",
    source: "POSTGRESQL",
    tables: [
      {
        name: "viajes",
        rows: [{ id_viaje: 1, estado: "PROGRAMADO" }],
      },
    ],
    sequences: [{ name: "viajes_id_viaje_seq", lastValue: "1" }],
  };
}

describe("formato de copia de datos de la aplicación", () => {
  it("cifra, comprime y recupera una copia válida", () => {
    const key = randomBytes(32);
    const archive = createApplicationBackup(fixture(), key);

    expect(archive.toString("utf8")).not.toContain("PROGRAMADO");
    expect(openApplicationBackup(archive, key)).toEqual(fixture());
  });

  it("rechaza corrupción y claves incorrectas", () => {
    const key = randomBytes(32);
    const archive = createApplicationBackup(fixture(), key);
    const envelope = JSON.parse(archive.toString("utf8")) as {
      payload: string;
    };
    envelope.payload = `${envelope.payload.slice(0, -4)}AAAA`;

    expect(() =>
      openApplicationBackup(Buffer.from(JSON.stringify(envelope)), key),
    ).toThrow("APPLICATION_BACKUP_CHECKSUM_MISMATCH");
    expect(() => openApplicationBackup(archive, randomBytes(32))).toThrow(
      "APPLICATION_BACKUP_AUTHENTICATION_FAILED",
    );
  });

  it("solo acepta claves hexadecimales de 32 bytes", () => {
    expect(backupKeyFromHex("ab".repeat(32))).toHaveLength(32);
    expect(() => backupKeyFromHex("corta")).toThrow(
      "BACKUP_ENCRYPTION_KEY_INVALID",
    );
  });
});

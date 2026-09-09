import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const BACKUP_FORMAT = "ECONNVRAE-APPLICATION-DATA-BACKUP";
const BACKUP_VERSION = 1;
const BACKUP_AAD = Buffer.from(`${BACKUP_FORMAT}-V${BACKUP_VERSION}`);
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_BACKUP_DOWNLOAD_BYTES = 4_000_000;

export interface ApplicationBackupTable {
  name: string;
  rows: unknown[];
}

export interface ApplicationBackupSnapshot {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  source: "POSTGRESQL";
  tables: ApplicationBackupTable[];
  sequences: Array<{ name: string; lastValue: string | null }>;
}

interface ApplicationBackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  algorithm: "aes-256-gcm";
  compression: "gzip";
  createdAt: string;
  tableCount: number;
  rowCount: number;
  sha256: string;
  nonce: string;
  tag: string;
  payload: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function backupKeyFromHex(encoded: string | undefined): Buffer {
  const normalized = encoded?.trim();
  if (!normalized || !/^[a-f0-9]{64}$/i.test(normalized)) {
    throw new Error("BACKUP_ENCRYPTION_KEY_INVALID");
  }
  return Buffer.from(normalized, "hex");
}

export function createApplicationBackup(
  snapshot: ApplicationBackupSnapshot,
  key: Buffer,
): Buffer {
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_INVALID");

  const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
  if (plaintext.byteLength > MAX_UNCOMPRESSED_BYTES) {
    throw new Error("APPLICATION_BACKUP_TOO_LARGE");
  }

  const compressed = gzipSync(plaintext, { level: 9 });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(BACKUP_AAD);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const rowCount = snapshot.tables.reduce(
    (total, table) => total + table.rows.length,
    0,
  );
  const envelope: ApplicationBackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    algorithm: "aes-256-gcm",
    compression: "gzip",
    createdAt: snapshot.createdAt,
    tableCount: snapshot.tables.length,
    rowCount,
    sha256: createHash("sha256").update(encrypted).digest("hex"),
    nonce: nonce.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    payload: encrypted.toString("base64"),
  };

  return Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
}

export function openApplicationBackup(
  archive: Buffer,
  key: Buffer,
): ApplicationBackupSnapshot {
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_INVALID");

  let envelope: unknown;
  try {
    envelope = JSON.parse(archive.toString("utf8"));
  } catch {
    throw new Error("APPLICATION_BACKUP_INVALID");
  }

  if (
    !isRecord(envelope) ||
    envelope.format !== BACKUP_FORMAT ||
    envelope.version !== BACKUP_VERSION ||
    envelope.algorithm !== "aes-256-gcm" ||
    envelope.compression !== "gzip" ||
    typeof envelope.createdAt !== "string" ||
    typeof envelope.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(envelope.sha256) ||
    typeof envelope.nonce !== "string" ||
    !/^[a-f0-9]{24}$/.test(envelope.nonce) ||
    typeof envelope.tag !== "string" ||
    !/^[a-f0-9]{32}$/.test(envelope.tag) ||
    typeof envelope.payload !== "string"
  ) {
    throw new Error("APPLICATION_BACKUP_INVALID");
  }

  const encrypted = Buffer.from(envelope.payload, "base64");
  const checksum = createHash("sha256").update(encrypted).digest("hex");
  if (checksum !== envelope.sha256) {
    throw new Error("APPLICATION_BACKUP_CHECKSUM_MISMATCH");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.nonce, "hex"),
    );
    decipher.setAAD(BACKUP_AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
    const compressed = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    const parsed = JSON.parse(gunzipSync(compressed).toString("utf8")) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.format !== BACKUP_FORMAT ||
      parsed.version !== BACKUP_VERSION ||
      parsed.source !== "POSTGRESQL" ||
      typeof parsed.createdAt !== "string" ||
      !Array.isArray(parsed.tables) ||
      !Array.isArray(parsed.sequences)
    ) {
      throw new Error("APPLICATION_BACKUP_INVALID");
    }
    return parsed as unknown as ApplicationBackupSnapshot;
  } catch (error) {
    if (error instanceof Error && error.message === "APPLICATION_BACKUP_INVALID") {
      throw error;
    }
    throw new Error("APPLICATION_BACKUP_AUTHENTICATION_FAILED");
  }
}

export function applicationBackupFormat(): {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
} {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION };
}

import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import type { BackupEntry } from "@/lib/domain/admin";
import { parseEntityId } from "@/lib/domain/ids";
import {
  applicationBackupFormat,
  backupKeyFromHex,
  createApplicationBackup,
  MAX_BACKUP_DOWNLOAD_BYTES,
  type ApplicationBackupSnapshot,
} from "@/lib/server/application-backup";
import { writeAuditLog } from "@/server/audit";
import { withTransaction, query } from "@/server/db/pool";
import { AppError } from "@/server/errors";

const TRANSIENT_TABLES = new Set(["rate_limits", "sesiones"]);

interface TableRow extends QueryResultRow {
  tablename: string;
}

interface SequenceRow extends QueryResultRow {
  sequencename: string;
  last_value: string | number | null;
}

interface BackupAuditRow extends QueryResultRow {
  id_audit: string;
  username: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface CreatedBackup {
  archive: Buffer;
  filename: string;
  entry: BackupEntry;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeBackupValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Buffer.isBuffer(value)) {
    return {
      $econnvraeType: "bytea",
      base64: value.toString("base64"),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeBackupValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        normalizeBackupValue(nested),
      ]),
    );
  }
  return value;
}

function configuredKey(): Buffer {
  try {
    return backupKeyFromHex(process.env.BACKUP_ENCRYPTION_KEY);
  } catch {
    throw new AppError(
      "BACKUP_NOT_CONFIGURED",
      "Las copias cifradas aún no están configuradas en el servidor.",
      503,
    );
  }
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

function mapBackupEntry(row: BackupAuditRow): BackupEntry {
  const metadata =
    row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    id: row.id_audit,
    filename: metadataString(metadata, "filename"),
    createdBy: row.username || "Sistema",
    createdAt: row.created_at,
    bytes: metadataNumber(metadata, "bytes"),
    tableCount: metadataNumber(metadata, "tableCount"),
    rowCount: metadataNumber(metadata, "rowCount"),
    sha256: metadataString(metadata, "sha256"),
  };
}

async function captureSnapshot(client: PoolClient): Promise<ApplicationBackupSnapshot> {
  await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const tablesResult = await client.query<TableRow>(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`,
  );
  const tables: ApplicationBackupSnapshot["tables"] = [];

  for (const { tablename } of tablesResult.rows) {
    if (TRANSIENT_TABLES.has(tablename)) continue;
    const rows = await client.query<QueryResultRow>(
      `SELECT * FROM ${quoteIdentifier(tablename)}`,
    );
    tables.push({
      name: tablename,
      rows: rows.rows.map((row) => normalizeBackupValue(row)),
    });
  }

  const sequencesResult = await client.query<SequenceRow>(
    `SELECT sequencename, last_value
     FROM pg_sequences
     WHERE schemaname = 'public'
     ORDER BY sequencename`,
  );
  const { format, version } = applicationBackupFormat();
  return {
    format,
    version,
    createdAt: new Date().toISOString(),
    source: "POSTGRESQL",
    tables,
    sequences: sequencesResult.rows.map((row) => ({
      name: row.sequencename,
      lastValue: row.last_value === null ? null : String(row.last_value),
    })),
  };
}

export function backupsAreConfigured(): boolean {
  try {
    const key = backupKeyFromHex(process.env.BACKUP_ENCRYPTION_KEY);
    key.fill(0);
    return true;
  } catch {
    return false;
  }
}

export async function listBackups(): Promise<BackupEntry[]> {
  const result = await query<BackupAuditRow>(
    `SELECT audit.id_audit::text, account.username, audit.created_at::text,
            audit.metadata
     FROM audit_logs audit
     LEFT JOIN usuarios account ON account.id_usuario = audit.id_usuario
     WHERE audit.accion = 'BACKUP_CREATED'
       AND audit.entidad = 'database_backup'
     ORDER BY audit.created_at DESC
     LIMIT 20`,
  );
  return result.rows.map(mapBackupEntry);
}

export async function createBackup(user: SessionUser): Promise<CreatedBackup> {
  const key = configuredKey();
  let archive: Buffer;
  let snapshot: ApplicationBackupSnapshot;
  try {
    snapshot = await withTransaction(captureSnapshot);
    archive = createApplicationBackup(snapshot, key);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "APPLICATION_BACKUP_TOO_LARGE"
    ) {
      throw new AppError(
        "BACKUP_TOO_LARGE",
        "La base supera el límite del panel. Usa la copia completa con pg_dump indicada en la documentación.",
        413,
      );
    }
    throw error;
  } finally {
    key.fill(0);
  }

  if (archive.byteLength > MAX_BACKUP_DOWNLOAD_BYTES) {
    throw new AppError(
      "BACKUP_TOO_LARGE",
      "La copia supera el límite de descarga del alojamiento. Usa la copia completa con pg_dump indicada en la documentación.",
      413,
    );
  }

  const createdAt = snapshot.createdAt;
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const filename = `econnvrae-${timestamp}.ecvbackup`;
  const rowCount = snapshot.tables.reduce(
    (total, table) => total + table.rows.length,
    0,
  );
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const actorId = parseEntityId(user.id, "U");
  await writeAuditLog({
    userId: actorId,
    agencyId: null,
    action: "BACKUP_CREATED",
    entity: "database_backup",
    entityId: timestamp,
    metadata: {
      filename,
      bytes: archive.byteLength,
      tableCount: snapshot.tables.length,
      rowCount,
      sha256,
      excludedTransientTables: [...TRANSIENT_TABLES],
    },
  });

  return {
    archive,
    filename,
    entry: {
      id: timestamp,
      filename,
      createdBy: user.username,
      createdAt,
      bytes: archive.byteLength,
      tableCount: snapshot.tables.length,
      rowCount,
      sha256,
    },
  };
}

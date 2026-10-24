import "server-only";

import type { QueryResultRow } from "pg";
import { query } from "@/server/db/pool";

interface AuditExecutor {
  query<Row extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export async function writeAuditLog(input: {
  userId: number | null;
  agencyId?: number | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
}, executor?: AuditExecutor): Promise<void> {
  const run = executor
    ? (text: string, values: unknown[]) => executor.query(text, values)
    : query;
  await run(
    `INSERT INTO audit_logs (
       id_usuario, id_agencia, accion, entidad, entidad_id, metadata, ip_hash
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      input.userId,
      input.agencyId || null,
      input.action,
      input.entity,
      input.entityId || null,
      JSON.stringify(input.metadata || {}),
      input.ipHash || null,
    ],
  );
}

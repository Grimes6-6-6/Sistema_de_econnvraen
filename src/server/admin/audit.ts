import "server-only";

import type { QueryResultRow } from "pg";
import type { SessionUser } from "@/lib/auth/types";
import type { AuditEntry } from "@/lib/domain/admin";
import { query } from "@/server/db/pool";

interface AuditRow extends QueryResultRow {
  id_audit: string;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  username: string | null;
  agencia: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export async function listAuditEntries(
  user: SessionUser,
): Promise<AuditEntry[]> {
  void user;
  const result = await query<AuditRow>(
    `SELECT audit.id_audit::text, audit.accion, audit.entidad, audit.entidad_id,
            account.username, agency.nombre AS agencia, audit.created_at::text,
            audit.metadata
     FROM audit_logs audit
     LEFT JOIN usuarios account ON account.id_usuario = audit.id_usuario
     LEFT JOIN agencias agency ON agency.id_agencia = audit.id_agencia
     ORDER BY audit.created_at DESC
     LIMIT 300`,
  );
  return result.rows.map((row) => ({
    id: row.id_audit,
    action: row.accion,
    entity: row.entidad,
    entityId: row.entidad_id || "",
    username: row.username || "Sistema",
    agencyName: row.agencia || "Global",
    createdAt: row.created_at,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  }));
}

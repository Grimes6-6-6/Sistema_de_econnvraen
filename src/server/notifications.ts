import "server-only";
import { createHash } from "node:crypto";
import type { SessionUser } from "@/lib/auth/types";
import { PERMISSIONS, roleHasPermission } from "@/lib/auth/permissions";
import { parseEntityId } from "@/lib/domain/ids";
import { documentNotificationCandidates, type InternalNotification } from "@/lib/domain/notifications";
import { listDriverOperationalDocuments, listOperationalDocuments } from "@/server/admin/documents";
import { query } from "@/server/db/pool";
import { forbidden, notFound } from "@/server/errors";

async function candidates(user: SessionUser): Promise<Omit<InternalNotification, "readAt">[]> {
  const driver = user.rol === "CONDUCTOR";
  if (!driver && !roleHasPermission(user.rol, PERMISSIONS.FLEET_MANAGE)) return [];
  const documents = driver ? await listDriverOperationalDocuments(user) : await listOperationalDocuments(user);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return documentNotificationCandidates(documents, driver, today).map(({ key, ...item }) => ({
    ...item, id: createHash("sha256").update(key).digest("hex"),
  }));
}

function actorId(user: SessionUser) {
  const id = parseEntityId(user.id, "U");
  if (!id) throw forbidden();
  return id;
}

export async function listNotifications(user: SessionUser) {
  const userId = actorId(user);
  const items = await candidates(user);
  if (!items.length) return { notifications: [], unreadCount: 0 };
  const reads = await query<{ clave: string; leida_at: Date }>(
    `SELECT clave, leida_at FROM notificaciones_lecturas WHERE id_usuario = $1 AND clave = ANY($2::text[])`,
    [userId, items.map((item) => item.id)],
  );
  const byKey = new Map(reads.rows.map((row) => [row.clave, new Date(row.leida_at).toISOString()]));
  const priority = { critical: 0, warning: 1, info: 2 };
  const notifications: InternalNotification[] = items.map((item) => ({ ...item, readAt: byKey.get(item.id) || null }))
    .sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || priority[a.severity] - priority[b.severity] || a.id.localeCompare(b.id));
  return { notifications, unreadCount: notifications.filter((item) => !item.readAt).length };
}

export async function markNotificationRead(user: SessionUser, key: string) {
  const userId = actorId(user);
  const accessible = await candidates(user);
  if (!accessible.some((item) => item.id === key)) throw notFound("El aviso ya no está disponible.");
  await query(`INSERT INTO notificaciones_lecturas (id_usuario, clave) VALUES ($1, $2) ON CONFLICT (id_usuario, clave) DO NOTHING`, [userId, key]);
}

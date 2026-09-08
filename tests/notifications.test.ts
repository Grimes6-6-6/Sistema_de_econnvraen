import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentNotificationCandidates } from "@/lib/domain/notifications";
import type { OperationalDocument } from "@/lib/domain/admin";
import type { SessionUser } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/pool", () => ({ query: vi.fn() }));
vi.mock("@/server/admin/documents", () => ({ listDriverOperationalDocuments: vi.fn(), listOperationalDocuments: vi.fn() }));
import { query } from "@/server/db/pool";
import { listDriverOperationalDocuments, listOperationalDocuments } from "@/server/admin/documents";
import { listNotifications, markNotificationRead } from "@/server/notifications";

const doc: OperationalDocument = { id: "DOC001", holderType: "CONDUCTOR", holderId: "C01", holderName: "Conductor de prueba", documentType: "LICENCIA", number: "TEST", issuedAt: "2025-01-01", expiresAt: "2026-10-01", state: "VIGENTE", notes: "", source: "CONDUCTOR", file: null };
const user: SessionUser = { id: "U001", username: "test", nombres: "Test", apellidos: "Test", rol: "SUPER_ADMIN", dni: "", conductorId: null, agenciaId: "A01", agenciaNombre: "Test", mustChangePassword: false };

describe("Avisos documentarios automáticos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 0 } as never);
    vi.mocked(listOperationalDocuments).mockResolvedValue([{ ...doc, state: "PENDIENTE" }]);
    vi.mocked(listDriverOperationalDocuments).mockResolvedValue([{ ...doc, state: "PENDIENTE" }]);
  });
  it("avisa 30 días antes, aumenta urgencia a 7 días y al vencer", () => {
    const early = documentNotificationCandidates([doc], false, "2026-09-01")[0];
    const week = documentNotificationCandidates([doc], false, "2026-09-24")[0];
    const expired = documentNotificationCandidates([doc], false, "2026-10-02")[0];
    expect(early.title).toContain("próximo");
    expect(week.severity).toBe("warning");
    expect(expired.severity).toBe("critical");
    expect(new Set([early.key, week.key, expired.key]).size).toBe(3);
    expect(documentNotificationCandidates([doc], false, "2026-08-01")).toHaveLength(0);
  });
  it("no oculta vencimiento por estar pendiente de revisión", () => {
    const [item] = documentNotificationCandidates([{ ...doc, state: "PENDIENTE" }], false, "2026-10-02");
    expect(item.severity).toBe("critical");
    expect(item.message).toContain("Pendiente de revisión");
  });
  it("solo toma el último documento del mismo titular y tipo", () => {
    const latest = { ...doc, id: "DOC002", expiresAt: "2027-10-01" };
    expect(documentNotificationCandidates([latest, doc], false, "2026-10-02")).toEqual([]);
  });
  it("las observaciones modificadas generan un aviso nuevo", () => {
    const original = { ...doc, state: "OBSERVADO" as const, notes: "Ilegible" };
    const first = documentNotificationCandidates([original], true, "2026-08-01")[0];
    const second = documentNotificationCandidates([{ ...original, notes: "Falta reverso" }], true, "2026-08-01")[0];
    expect(first.key).not.toBe(second.key);
  });
  it("el conductor también recibe confirmación de validación", () => {
    expect(documentNotificationCandidates([doc], true, "2026-08-01")[0].title).toBe("Documento validado");
  });
  it("no consulta documentos para operadores", async () => {
    expect(await listNotifications({ ...user, rol: "OPERADOR" })).toEqual({ notifications: [], unreadCount: 0 });
    expect(listOperationalDocuments).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it("los conductores usan solo la consulta restringida a su perfil", async () => {
    const driver = { ...user, rol: "CONDUCTOR" as const, conductorId: "C01" };
    await listNotifications(driver);
    expect(listDriverOperationalDocuments).toHaveBeenCalledWith(driver);
    expect(listOperationalDocuments).not.toHaveBeenCalled();
  });
  it("administrador conserva la agencia al consultar documentos", async () => {
    const admin = { ...user, rol: "ADMINISTRADOR" as const, agenciaId: "A02" };
    await listNotifications(admin);
    expect(listOperationalDocuments).toHaveBeenCalledWith(admin);
  });
  it("carga lecturas solo del usuario autenticado", async () => {
    const result = await listNotifications(user);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("id_usuario = $1"), [1, [result.notifications[0].id]]);
    expect(result.unreadCount).toBe(1);
  });
  it("no permite marcar una clave ajena o que ya dejó de existir", async () => {
    await expect(markNotificationRead(user, "a".repeat(64))).rejects.toThrow("ya no está disponible");
    expect(query).not.toHaveBeenCalled();
  });
  it("marca solo el usuario de la sesión y es idempotente", async () => {
    const result = await listNotifications(user);
    const id = result.notifications[0].id;
    await markNotificationRead(user, id);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("ON CONFLICT"), [1, id]);
  });
});

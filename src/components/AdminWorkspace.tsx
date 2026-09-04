"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileClock,
  KeyRound,
  Plus,
  Route,
  ShieldCheck,
  Truck,
  UserCog,
  XCircle,
} from "lucide-react";
import { PERMISSIONS, roleHasPermission } from "@/lib/auth/permissions";
import type {
  AuditEntry,
  ManagedRoute,
  ManagedUser,
  ManagedVehicle,
  OperationalDocument,
  TicketCancellationRequest,
} from "@/lib/domain/admin";
import type { Agency } from "@/lib/domain/agency";
import { useDatabase } from "@/context/DatabaseContext";
import { useFeedback } from "@/components/ui/FeedbackProvider";

interface RouteDestination {
  id: string;
  code: string;
  city: string;
  name: string;
}

interface ApiError {
  error?: { message?: string };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok) {
    throw new Error((payload as ApiError | null)?.error?.message || "No se pudo completar la operación.");
  }
  return payload as T;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: value.includes("T") ? "short" : undefined,
  }).format(new Date(value));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const panelClass =
  "rounded-3xl border border-white/10 bg-slate-900/60 p-4 shadow-premium backdrop-blur-md sm:p-6";
const inputClass =
  "mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-500";

export default function AdminWorkspace() {
  const { currentUser, db, refreshDatabase } = useDatabase();
  const { notify, requestConfirmation } = useFeedback();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [requests, setRequests] = useState<TicketCancellationRequest[]>([]);
  const [routes, setRoutes] = useState<ManagedRoute[]>([]);
  const [vehicles, setVehicles] = useState<ManagedVehicle[]>([]);
  const [documents, setDocuments] = useState<OperationalDocument[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [destinations, setDestinations] = useState<RouteDestination[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newUserRole, setNewUserRole] = useState<ManagedUser["role"]>("OPERADOR");
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editingRole, setEditingRole] = useState<ManagedUser["role"]>("OPERADOR");
  const [documentHolderType, setDocumentHolderType] = useState<"VEHICULO" | "CONDUCTOR">("VEHICULO");
  const [editingAgency, setEditingAgency] = useState<Agency | null>(null);
  const [temporaryCredential, setTemporaryCredential] = useState<{
    username: string;
    password: string;
  } | null>(null);

  const can = useCallback(
    (permission: Parameters<typeof roleHasPermission>[1]) =>
      Boolean(currentUser && roleHasPermission(currentUser.rol, permission)),
    [currentUser],
  );

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const tasks: Promise<void>[] = [];
      if (can(PERMISSIONS.USER_MANAGE)) {
        tasks.push(
          api<{ users: ManagedUser[] }>("/api/admin/users").then((value) => setUsers(value.users)),
        );
      }
      if (can(PERMISSIONS.TICKET_CANCEL_APPROVE)) {
        tasks.push(
          api<{ requests: TicketCancellationRequest[] }>("/api/admin/cancellation-requests").then((value) => setRequests(value.requests)),
        );
      }
      if (can(PERMISSIONS.FLEET_MANAGE)) {
        tasks.push(
          api<{ routes: ManagedRoute[] }>("/api/admin/routes").then((value) => setRoutes(value.routes)),
          api<{ vehicles: ManagedVehicle[] }>("/api/admin/vehicles").then((value) => setVehicles(value.vehicles)),
          api<{ documents: OperationalDocument[] }>("/api/admin/documents").then((value) => setDocuments(value.documents)),
          api<{ agencies: RouteDestination[] }>("/api/admin/route-destinations").then((value) => setDestinations(value.agencies)),
        );
      }
      if (can(PERMISSIONS.AGENCY_MANAGE)) {
        tasks.push(
          api<{ agencies: Agency[] }>("/api/admin/agencies").then((value) => setAgencies(value.agencies)),
        );
      } else {
        tasks.push(
          api<{ agencies: Agency[] }>("/api/agencies").then((value) => setAgencies(value.agencies)),
        );
      }
      if (can(PERMISSIONS.AUDIT_VIEW)) {
        tasks.push(
          api<{ entries: AuditEntry[] }>("/api/admin/audit").then((value) => setAudit(value.entries)),
        );
      }
      await Promise.all(tasks);
    } catch (reason) {
      notify({
        type: "error",
        title: "No se pudo cargar la administración",
        message: reason instanceof Error ? reason.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [can, currentUser, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeAgencies = useMemo(() => agencies.filter((agency) => agency.isActive), [agencies]);
  const pendingRequests = requests.filter((request) => request.state === "PENDIENTE");

  if (!currentUser) return null;
  if (loading) {
    return <div className={panelClass}><p className="text-sm font-bold text-slate-300">Cargando controles administrativos…</p></div>;
  }

  const createUser = async (formData: FormData) => {
    const form = document.getElementById("create-managed-user") as HTMLFormElement | null;
    setBusy(true);
    try {
      const role = String(formData.get("role")) as ManagedUser["role"];
      const payload = {
        username: formData.get("username"),
        dni: formData.get("dni"),
        names: formData.get("names"),
        surnames: formData.get("surnames"),
        phone: formData.get("phone"),
        email: formData.get("email"),
        role,
        agencyIds: [formData.get("agencyId")],
        driver:
          role === "CONDUCTOR"
            ? {
                licenseNumber: formData.get("licenseNumber"),
                licenseCategory: formData.get("licenseCategory"),
                licenseExpiresAt: formData.get("licenseExpiresAt"),
              }
            : undefined,
      };
      const created = await api<{ user: ManagedUser; temporaryPassword: string }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUsers((current) => [...current, created.user]);
      setTemporaryCredential({ username: created.user.username, password: created.temporaryPassword });
      form?.reset();
      setNewUserRole("OPERADOR");
      notify({ type: "success", title: "Usuario creado", message: "Copia la contraseña temporal; se muestra una sola vez." });
    } catch (reason) {
      notify({ type: "error", title: "No se pudo crear el usuario", message: reason instanceof Error ? reason.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const saveUser = async (formData: FormData) => {
    if (!editingUser) return;
    setBusy(true);
    try {
      const payload = {
        username: formData.get("username"),
        names: formData.get("names"),
        surnames: formData.get("surnames"),
        phone: formData.get("phone"),
        email: formData.get("email"),
        role: formData.get("role"),
        agencyIds: [formData.get("agencyId")],
        driver:
          formData.get("role") === "CONDUCTOR"
            ? {
                licenseNumber: formData.get("licenseNumber"),
                licenseCategory: formData.get("licenseCategory"),
                licenseExpiresAt: formData.get("licenseExpiresAt"),
              }
            : undefined,
      };
      const updated = await api<{ user: ManagedUser }>(`/api/admin/users/${editingUser.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setUsers((current) => current.map((item) => (item.id === updated.user.id ? updated.user : item)));
      setEditingUser(null);
      notify({ type: "success", title: "Usuario actualizado" });
    } catch (reason) {
      notify({ type: "error", title: "No se pudo actualizar", message: reason instanceof Error ? reason.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const toggleUser = async (managedUser: ManagedUser) => {
    const nextState = managedUser.state === "ACTIVO" ? "BLOQUEADO" : "ACTIVO";
    const confirmation = await requestConfirmation({
      title: nextState === "ACTIVO" ? "Reactivar usuario" : "Bloquear usuario",
      message: nextState === "ACTIVO" ? "La cuenta recuperará el acceso." : "Sus sesiones abiertas se cerrarán inmediatamente.",
      confirmLabel: nextState === "ACTIVO" ? "Reactivar" : "Bloquear",
      cancelLabel: "Volver",
      tone: nextState === "ACTIVO" ? "primary" : "danger",
    });
    if (!confirmation.confirmed) return;
    setBusy(true);
    try {
      const updated = await api<{ user: ManagedUser }>(`/api/admin/users/${managedUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({ state: nextState }),
      });
      setUsers((current) => current.map((item) => (item.id === updated.user.id ? updated.user : item)));
    } catch (reason) {
      notify({ type: "error", title: "No se pudo cambiar el estado", message: reason instanceof Error ? reason.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (managedUser: ManagedUser) => {
    const confirmation = await requestConfirmation({
      title: "Restablecer contraseña",
      message: "Se cerrarán las sesiones del usuario y la nueva clave vencerá en 24 horas.",
      confirmLabel: "Restablecer",
      cancelLabel: "Volver",
      tone: "danger",
    });
    if (!confirmation.confirmed) return;
    setBusy(true);
    try {
      const result = await api<{ temporaryPassword: string }>(`/api/admin/users/${managedUser.id}/reset-password`, { method: "POST" });
      setTemporaryCredential({ username: managedUser.username, password: result.temporaryPassword });
      await load();
    } catch (reason) {
      notify({ type: "error", title: "No se pudo restablecer", message: reason instanceof Error ? reason.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const resetMfa = async (managedUser: ManagedUser) => {
    const confirmation = await requestConfirmation({
      title: "Restablecer segundo factor",
      message: "Se cerrarán las sesiones y el usuario deberá vincular nuevamente su aplicación autenticadora.",
      confirmLabel: "Restablecer 2FA",
      cancelLabel: "Volver",
      tone: "danger",
    });
    if (!confirmation.confirmed) return;
    setBusy(true);
    try {
      await api<{ success: boolean }>(`/api/admin/users/${managedUser.id}/reset-mfa`, { method: "POST" });
      notify({ type: "success", title: "Segundo factor restablecido", message: "El usuario deberá configurarlo en su próximo ingreso." });
      await load();
    } catch (reason) {
      notify({ type: "error", title: "No se pudo restablecer 2FA", message: reason instanceof Error ? reason.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const resolveCancellation = async (request: TicketCancellationRequest, decision: "APROBADA" | "RECHAZADA") => {
    const confirmation = await requestConfirmation({
      title: decision === "APROBADA" ? "Aprobar anulación" : "Rechazar anulación",
      message: decision === "APROBADA" ? "El asiento se liberará y la operación quedará auditada." : "El boleto continuará activo.",
      confirmLabel: decision === "APROBADA" ? "Aprobar" : "Rechazar",
      cancelLabel: "Volver",
      tone: decision === "APROBADA" ? "danger" : "primary",
      input: { label: "Motivo de resolución", placeholder: "Registra el sustento", minLength: 5 },
    });
    if (!confirmation.confirmed) return;
    setBusy(true);
    try {
      const result = await api<{ request: TicketCancellationRequest }>(`/api/admin/cancellation-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ decision, reason: confirmation.value }),
      });
      setRequests((current) => current.map((item) => (item.id === result.request.id ? result.request : item)));
      if (decision === "APROBADA") await refreshDatabase();
      notify({ type: "success", title: decision === "APROBADA" ? "Anulación aprobada" : "Solicitud rechazada" });
    } catch (reason) {
      notify({ type: "error", title: "No se pudo resolver", message: reason instanceof Error ? reason.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const createVehicle = async (formData: FormData) => {
    setBusy(true);
    try {
      const created = await api<{ vehicle: ManagedVehicle }>("/api/admin/vehicles", {
        method: "POST",
        body: JSON.stringify({
          agencyId: formData.get("agencyId"), plate: formData.get("plate"),
          type: formData.get("type"), brand: formData.get("brand"), model: formData.get("model"),
          capacity: Number(formData.get("capacity")), year: Number(formData.get("year")) || null,
          state: "ACTIVO",
        }),
      });
      setVehicles((current) => [...current, created.vehicle]);
      notify({ type: "success", title: "Vehículo registrado" });
    } catch (reason) {
      notify({ type: "error", title: "No se pudo registrar el vehículo", message: reason instanceof Error ? reason.message : undefined });
    } finally { setBusy(false); }
  };

  const createRoute = async (formData: FormData) => {
    setBusy(true);
    try {
      const created = await api<{ route: ManagedRoute }>("/api/admin/routes", {
        method: "POST",
        body: JSON.stringify({
          originAgencyId: formData.get("originAgencyId"), destinationAgencyId: formData.get("destinationAgencyId"),
          distanceKm: Number(formData.get("distanceKm")), durationHours: Number(formData.get("durationHours")),
          price: Number(formData.get("price")), state: "ACTIVO",
        }),
      });
      setRoutes((current) => [...current, created.route]);
      await refreshDatabase();
      notify({ type: "success", title: "Ruta creada" });
    } catch (reason) {
      notify({ type: "error", title: "No se pudo crear la ruta", message: reason instanceof Error ? reason.message : undefined });
    } finally { setBusy(false); }
  };

  const updateRoutePrice = async (route: ManagedRoute) => {
    const confirmation = await requestConfirmation({
      title: `Precio de ${route.origin} a ${route.destination}`,
      message: `Precio actual: S/ ${route.price.toFixed(2)}. El cambio quedará auditado.`,
      confirmLabel: "Actualizar",
      cancelLabel: "Volver",
      input: { label: "Nuevo precio", placeholder: "Ej.: 60.00", minLength: 1 },
    });
    if (!confirmation.confirmed) return;
    const price = Number(confirmation.value);
    if (!Number.isFinite(price) || price < 0) {
      notify({ type: "warning", title: "Precio no válido" });
      return;
    }
    setBusy(true);
    try {
      const updated = await api<{ route: ManagedRoute }>(`/api/admin/routes/${route.id}`, { method: "PATCH", body: JSON.stringify({ price }) });
      setRoutes((current) => current.map((item) => (item.id === route.id ? updated.route : item)));
      await refreshDatabase();
    } catch (reason) {
      notify({ type: "error", title: "No se pudo actualizar", message: reason instanceof Error ? reason.message : undefined });
    } finally { setBusy(false); }
  };

  const setVehicleState = async (
    vehicle: ManagedVehicle,
    state: ManagedVehicle["state"],
  ) => {
    setBusy(true);
    try {
      const updated = await api<{ vehicle: ManagedVehicle }>(`/api/admin/vehicles/${vehicle.id}`, {
        method: "PATCH",
        body: JSON.stringify({ state }),
      });
      setVehicles((current) => current.map((item) => (item.id === vehicle.id ? updated.vehicle : item)));
      await refreshDatabase();
    } catch (reason) {
      notify({ type: "error", title: "No se pudo actualizar el vehículo", message: reason instanceof Error ? reason.message : undefined });
    } finally { setBusy(false); }
  };

  const createDocument = async (formData: FormData) => {
    setBusy(true);
    try {
      const created = await api<{ document: OperationalDocument }>("/api/admin/documents", {
        method: "POST",
        body: JSON.stringify({
          holderType: formData.get("holderType"), holderId: formData.get("holderId"),
          documentType: formData.get("documentType"), number: formData.get("number"),
          issuedAt: formData.get("issuedAt"), expiresAt: formData.get("expiresAt"),
          state: "VIGENTE", notes: formData.get("notes"),
        }),
      });
      setDocuments((current) => [...current, created.document]);
      notify({ type: "success", title: "Documento registrado" });
    } catch (reason) {
      notify({ type: "error", title: "No se pudo registrar el documento", message: reason instanceof Error ? reason.message : undefined });
    } finally { setBusy(false); }
  };

  const reviewDocument = async (
    document: OperationalDocument,
    decision: "APROBAR" | "OBSERVAR",
  ) => {
    const confirmation = await requestConfirmation({
      title: decision === "APROBAR" ? "Aprobar documento" : "Observar documento",
      message:
        decision === "APROBAR"
          ? `Confirma que revisaste el archivo ${document.documentType} de ${document.holderName}.`
          : `Indica qué debe corregir ${document.holderName}.`,
      confirmLabel: decision === "APROBAR" ? "Aprobar" : "Enviar observación",
      cancelLabel: "Cancelar",
      ...(decision === "OBSERVAR"
        ? {
            input: {
              label: "Motivo de la observación",
              placeholder: "Ej.: la imagen no permite leer la fecha de vencimiento",
              minLength: 3,
            },
          }
        : {}),
    });
    if (!confirmation.confirmed) return;

    setBusy(true);
    try {
      const result = await api<{ document: OperationalDocument }>(
        `/api/admin/documents/${document.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            decision,
            reason: confirmation.value || "",
          }),
        },
      );
      setDocuments((current) =>
        current.map((item) =>
          item.id === result.document.id ? result.document : item,
        ),
      );
      window.dispatchEvent(new Event("operational-documents-updated"));
      await refreshDatabase();
      notify({
        type: "success",
        title: decision === "APROBAR" ? "Documento aprobado" : "Observación enviada",
      });
    } catch (reason) {
      notify({
        type: "error",
        title: "No se pudo revisar el documento",
        message: reason instanceof Error ? reason.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleAgency = async (agency: Agency) => {
    setBusy(true);
    try {
      const result = await api<{ agency: Agency }>(`/api/agencies/${agency.id}`, {
        method: "PATCH",
        body: JSON.stringify({ state: agency.isActive ? "INACTIVA" : "ACTIVA" }),
      });
      setAgencies((current) => current.map((item) => (item.id === agency.id ? result.agency : item)));
    } catch (reason) {
      notify({ type: "error", title: "No se pudo actualizar la agencia", message: reason instanceof Error ? reason.message : undefined });
    } finally { setBusy(false); }
  };

  const saveAgency = async (formData: FormData) => {
    if (!editingAgency) return;
    setBusy(true);
    try {
      const result = await api<{ agency: Agency }>(`/api/agencies/${editingAgency.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          code: formData.get("code"), name: formData.get("name"), city: formData.get("city"),
          address: formData.get("address"), phone: formData.get("phone"), email: formData.get("email"),
        }),
      });
      setAgencies((current) => current.map((item) => (item.id === result.agency.id ? result.agency : item)));
      setEditingAgency(null);
      notify({ type: "success", title: "Agencia actualizada" });
    } catch (reason) {
      notify({ type: "error", title: "No se pudo actualizar la agencia", message: reason instanceof Error ? reason.message : undefined });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="border-b border-white/10 pb-4">
        <h2 className="text-2xl font-black text-white sm:text-3xl">Administración empresarial</h2>
        <p className="mt-1 text-xs text-slate-400">Controles disponibles según tu rol y agencia activa.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Usuarios", value: users.length, Icon: UserCog },
          { label: "Anulaciones pendientes", value: pendingRequests.length, Icon: FileClock },
          { label: "Vehículos", value: vehicles.length, Icon: Truck },
          { label: "Documentos por vencer", value: documents.filter((item) => item.state === "POR_VENCER" || item.state === "VENCIDO").length, Icon: ShieldCheck },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <Icon className="h-5 w-5 text-emerald-400" />
            <p className="mt-3 text-2xl font-black text-white">{value}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {temporaryCredential && (
        <div role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-amber-300">Credencial temporal — visible una sola vez</p>
              <p className="mt-2 font-mono text-sm text-white">Usuario: {temporaryCredential.username}</p>
              <p className="font-mono text-sm text-white">Contraseña: {temporaryCredential.password}</p>
              <p className="mt-1 text-[11px] text-amber-100/80">Vence en 24 horas y obliga a crear una contraseña personal.</p>
            </div>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(`${temporaryCredential.username}\n${temporaryCredential.password}`)}
              className="rounded-xl border border-amber-400/30 px-3 py-2 text-xs font-bold text-amber-200"
            >
              <ClipboardCopy className="mr-1 inline h-4 w-4" /> Copiar
            </button>
          </div>
        </div>
      )}

      {can(PERMISSIONS.USER_MANAGE) && (
        <section className={panelClass}>
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="font-black text-white">Usuarios y accesos</h3><p className="text-xs text-slate-400">Roles, agencias, bloqueo y restablecimiento seguro.</p></div>
            <UserCog className="h-6 w-6 text-emerald-400" />
          </div>
          <details className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-wider text-emerald-300"><Plus className="mr-1 inline h-4 w-4" /> Crear usuario</summary>
            <form id="create-managed-user" action={(data) => void createUser(data)} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-bold text-slate-300">Usuario<input name="username" required minLength={3} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-300">DNI<input name="dni" required pattern="\d{8}" maxLength={8} className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-300">Nombres<input name="names" required className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-300">Apellidos<input name="surnames" required className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-300">Celular para acceso por SMS<input name="phone" pattern="9\d{8}" required className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-300">Correo<input name="email" type="email" className={inputClass} /></label>
              <label className="text-xs font-bold text-slate-300">Rol<select name="role" value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as ManagedUser["role"])} className={inputClass}>
                {currentUser.rol === "SUPER_ADMIN" && <option value="ADMINISTRADOR">Administrador</option>}
                <option value="OPERADOR">Operador</option><option value="CONDUCTOR">Conductor</option>
                {currentUser.rol === "SUPER_ADMIN" && <option value="SUPER_ADMIN">Superadministrador</option>}
              </select></label>
              <label className="text-xs font-bold text-slate-300">Agencia<select name="agencyId" required className={inputClass}>{activeAgencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.code} · {agency.city}</option>)}</select></label>
              {newUserRole === "CONDUCTOR" && <>
                <label className="text-xs font-bold text-slate-300">Licencia<input name="licenseNumber" required className={inputClass} /></label>
                <label className="text-xs font-bold text-slate-300">Categoría<input name="licenseCategory" required className={inputClass} /></label>
                <label className="text-xs font-bold text-slate-300">Vencimiento<input name="licenseExpiresAt" type="date" required className={inputClass} /></label>
              </>}
              <button type="submit" disabled={busy} className="self-end rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-60">Crear cuenta</button>
            </form>
          </details>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead><tr className="border-b border-white/10 text-left text-[10px] uppercase text-slate-500"><th className="p-2">Usuario</th><th className="p-2">Rol</th><th className="p-2">Agencia</th><th className="p-2">Estado</th><th className="p-2 text-right">Acciones</th></tr></thead>
              <tbody>{users.map((item) => <tr key={item.id} className="border-b border-white/5 text-slate-300"><td className="p-2"><b className="text-white">{item.username}</b><span className="block text-[10px] text-slate-500">{item.names} {item.surnames}</span></td><td className="p-2">{item.role}</td><td className="p-2">{item.agencyNames.join(", ")}</td><td className="p-2"><span className={item.state === "ACTIVO" ? "text-emerald-300" : "text-rose-300"}>{item.state}</span><span className={`block text-[9px] ${item.phone ? "text-emerald-300" : "text-amber-300"}`}>{item.phone ? "SMS listo" : "Celular pendiente"}</span>{item.mfaEnabled && <span className="block text-[9px] text-blue-300">App autenticadora activa</span>}{item.mustChangePassword && <span className="block text-[9px] text-amber-300">Cambio de clave pendiente</span>}</td><td className="p-2"><div className="flex justify-end gap-1"><button type="button" onClick={() => { setEditingUser(item); setEditingRole(item.role); }} className="rounded-lg border border-white/10 px-2 py-1">Editar</button><button type="button" aria-label={`Restablecer contraseña de ${item.username}`} onClick={() => void resetPassword(item)} className="rounded-lg border border-amber-500/30 px-2 py-1 text-amber-300"><KeyRound className="h-3.5 w-3.5" /></button>{item.mfaEnabled && <button type="button" aria-label={`Restablecer segundo factor de ${item.username}`} onClick={() => void resetMfa(item)} className="rounded-lg border border-blue-500/30 px-2 py-1 text-blue-300"><ShieldCheck className="h-3.5 w-3.5" /></button>}<button type="button" onClick={() => void toggleUser(item)} className="rounded-lg border border-rose-500/30 px-2 py-1 text-rose-300">{item.state === "ACTIVO" ? "Bloquear" : "Activar"}</button></div></td></tr>)}</tbody>
            </table>
          </div>
          {editingUser && (
            <form action={(data) => void saveUser(data)} className="mt-4 grid gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <p className="sm:col-span-2 lg:col-span-3 text-xs font-black uppercase text-emerald-300">Editar {editingUser.username}</p>
              <label className="text-xs font-bold">Usuario<input name="username" defaultValue={editingUser.username} required className={inputClass} /></label>
              <label className="text-xs font-bold">Nombres<input name="names" defaultValue={editingUser.names} required className={inputClass} /></label>
              <label className="text-xs font-bold">Apellidos<input name="surnames" defaultValue={editingUser.surnames} required className={inputClass} /></label>
              <label className="text-xs font-bold">Celular<input name="phone" defaultValue={editingUser.phone} className={inputClass} /></label>
              <label className="text-xs font-bold">Correo<input name="email" type="email" defaultValue={editingUser.email} className={inputClass} /></label>
              <label className="text-xs font-bold">Rol<select name="role" value={editingRole} onChange={(event) => setEditingRole(event.target.value as ManagedUser["role"])} className={inputClass}>{currentUser.rol === "SUPER_ADMIN" && <option value="ADMINISTRADOR">Administrador</option>}<option value="OPERADOR">Operador</option><option value="CONDUCTOR">Conductor</option>{currentUser.rol === "SUPER_ADMIN" && <option value="SUPER_ADMIN">Superadministrador</option>}</select></label>
              <label className="text-xs font-bold">Agencia<select name="agencyId" defaultValue={editingUser.agencyIds[0]} className={inputClass}>{activeAgencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.code} · {agency.city}</option>)}</select></label>
              {editingRole === "CONDUCTOR" && <><label className="text-xs font-bold">Licencia<input name="licenseNumber" defaultValue={editingUser.driver?.licenseNumber} required className={inputClass} /></label><label className="text-xs font-bold">Categoría<input name="licenseCategory" defaultValue={editingUser.driver?.licenseCategory} required className={inputClass} /></label><label className="text-xs font-bold">Vencimiento<input name="licenseExpiresAt" type="date" defaultValue={editingUser.driver?.licenseExpiresAt} required className={inputClass} /></label></>}
              <div className="flex items-end gap-2"><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white">Guardar</button><button type="button" onClick={() => setEditingUser(null)} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold">Cancelar</button></div>
            </form>
          )}
        </section>
      )}

      {can(PERMISSIONS.TICKET_CANCEL_APPROVE) && (
        <section className={panelClass}>
          <h3 className="font-black text-white">Solicitudes de anulación</h3>
          <p className="text-xs text-slate-400">El operador solicita; un administrador revisa y resuelve.</p>
          <div className="mt-4 space-y-2">{pendingRequests.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-slate-500">No hay solicitudes pendientes.</p> : pendingRequests.map((request) => <article key={request.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><b className="text-sm text-white">{request.ticketCode} · {request.passengerName}</b><p className="text-xs text-slate-400">{request.requestReason}</p><p className="text-[10px] text-slate-500">Solicitó {request.requestedBy} · {formatDate(request.requestedAt)}</p></div><div className="flex gap-2"><button disabled={busy} onClick={() => void resolveCancellation(request, "APROBADA")} className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white"><CheckCircle2 className="mr-1 inline h-4 w-4" /> Aprobar</button><button disabled={busy} onClick={() => void resolveCancellation(request, "RECHAZADA")} className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold"><XCircle className="mr-1 inline h-4 w-4" /> Rechazar</button></div></article>)}</div>
        </section>
      )}

      {can(PERMISSIONS.FLEET_MANAGE) && (
        <section className={panelClass}>
          <div className="flex items-center gap-2"><Truck className="h-5 w-5 text-emerald-400" /><h3 className="font-black text-white">Flota, rutas y documentos</h3></div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <details className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><summary className="cursor-pointer text-xs font-black uppercase text-emerald-300">Registrar vehículo</summary><form action={(data) => void createVehicle(data)} className="mt-3 space-y-2"><select name="agencyId" className={inputClass}>{activeAgencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.code} · {agency.city}</option>)}</select><input name="plate" required placeholder="Placa" className={inputClass} /><input name="type" required placeholder="Tipo" className={inputClass} /><input name="brand" required placeholder="Marca" className={inputClass} /><input name="model" required placeholder="Modelo" className={inputClass} /><div className="grid grid-cols-2 gap-2"><input name="capacity" type="number" min={1} max={80} required placeholder="Capacidad" className={inputClass} /><input name="year" type="number" min={1990} max={2100} placeholder="Año" className={inputClass} /></div><button disabled={busy} className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white">Guardar vehículo</button></form></details>
            <details className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><summary className="cursor-pointer text-xs font-black uppercase text-emerald-300">Crear ruta</summary><form action={(data) => void createRoute(data)} className="mt-3 space-y-2"><label className="text-[10px] text-slate-400">Origen<select name="originAgencyId" defaultValue={currentUser.agenciaId || ""} className={inputClass}>{destinations.map((agency) => <option key={agency.id} value={agency.id}>{agency.code} · {agency.city}</option>)}</select></label><label className="text-[10px] text-slate-400">Destino<select name="destinationAgencyId" className={inputClass}>{destinations.filter((agency) => agency.id !== currentUser.agenciaId).map((agency) => <option key={agency.id} value={agency.id}>{agency.code} · {agency.city}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><input name="distanceKm" type="number" step="0.1" required placeholder="Km" className={inputClass} /><input name="durationHours" type="number" step="0.1" required placeholder="Horas" className={inputClass} /></div><input name="price" type="number" step="0.1" required placeholder="Precio base" className={inputClass} /><button disabled={busy} className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white">Guardar ruta</button></form></details>
            <details className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><summary className="cursor-pointer text-xs font-black uppercase text-emerald-300">Registrar documento</summary><form action={(data) => void createDocument(data)} className="mt-3 space-y-2"><select name="holderType" value={documentHolderType} onChange={(event) => setDocumentHolderType(event.target.value as "VEHICULO" | "CONDUCTOR")} className={inputClass}><option value="VEHICULO">Vehículo</option><option value="CONDUCTOR">Conductor</option></select><select name="holderId" className={inputClass}>{documentHolderType === "VEHICULO" ? db.vehiculos.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.placa}</option>) : db.conductores.map((driver) => <option key={driver.id} value={driver.id}>{driver.nombres}</option>)}</select><select name="documentType" className={inputClass}><option value="SOAT">SOAT</option><option value="CITV">Revisión técnica (CITV)</option><option value="TUC">TUC</option><option value="TARJETA_PROPIEDAD">Tarjeta de propiedad</option><option value="LICENCIA">Licencia</option><option value="ANTECEDENTES">Antecedentes</option><option value="SALUD">Aptitud médica</option><option value="OTRO">Otro</option></select><input name="number" required placeholder="Número" className={inputClass} /><div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-400">Emisión<input name="issuedAt" type="date" className={inputClass} /></label><label className="text-[10px] text-slate-400">Vencimiento<input name="expiresAt" type="date" required className={inputClass} /></label></div><input name="notes" placeholder="Observación" className={inputClass} /><button disabled={busy} className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white">Guardar documento</button></form></details>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div><h4 className="text-xs font-black uppercase text-slate-300"><Route className="mr-1 inline h-4 w-4" /> Rutas y precios</h4><div className="mt-2 space-y-2">{routes.map((route) => <div key={route.id} className="flex items-center justify-between rounded-xl border border-white/10 p-3 text-xs"><span><b className="text-white">{route.origin} → {route.destination}</b><small className="block text-slate-500">{route.distanceKm} km · {route.durationHours} h</small></span><button onClick={() => void updateRoutePrice(route)} className="rounded-lg border border-emerald-500/30 px-2 py-1 text-emerald-300">S/ {route.price.toFixed(2)}</button></div>)}</div></div>
            <div>
              <h4 className="text-xs font-black uppercase text-slate-300"><FileClock className="mr-1 inline h-4 w-4" /> Vigencias documentarias</h4>
              <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
                {documents.length === 0 ? (
                  <p className="text-xs text-slate-500">Aún no hay documentos registrados.</p>
                ) : documents.map((document) => (
                  <div key={document.id} className="rounded-xl border border-white/10 p-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <b className="block truncate text-white">{document.documentType} · {document.holderName}</b>
                        <small className="block text-slate-500">Vence {formatDate(document.expiresAt)}</small>
                        {document.source === "CONDUCTOR" && (
                          <small className="block font-bold text-blue-300">Subido por el conductor</small>
                        )}
                        {document.file && (
                          <small className="block truncate text-slate-500">{document.file.name} · {formatFileSize(document.file.size)}</small>
                        )}
                      </span>
                      <span className={document.state === "VIGENTE" ? "text-emerald-300" : document.state === "POR_VENCER" ? "text-amber-300" : document.state === "PENDIENTE" ? "text-blue-300" : "text-rose-300"}>{document.state.replace("_", " ")}</span>
                    </div>
                    {(document.file || document.state === "PENDIENTE") && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                        {document.file && (
                          <a href={document.file.downloadUrl} className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 font-bold text-slate-300 hover:bg-slate-800">
                            <Download className="h-3.5 w-3.5" /> Descargar
                          </a>
                        )}
                        {document.state === "PENDIENTE" && (
                          <>
                            <button type="button" disabled={busy} onClick={() => void reviewDocument(document, "APROBAR")} className="rounded-lg bg-emerald-700 px-2 py-1 font-bold text-white disabled:opacity-50">Aprobar</button>
                            <button type="button" disabled={busy} onClick={() => void reviewDocument(document, "OBSERVAR")} className="rounded-lg border border-rose-500/40 px-2 py-1 font-bold text-rose-300 disabled:opacity-50">Observar</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5">
            <h4 className="text-xs font-black uppercase text-slate-300"><Truck className="mr-1 inline h-4 w-4" /> Estado de vehículos</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{vehicles.map((vehicle) => <div key={vehicle.id} className="rounded-xl border border-white/10 p-3 text-xs"><div className="flex items-center justify-between"><span><b className="text-white">{vehicle.plate}</b><small className="block text-slate-500">{vehicle.brand} {vehicle.model} · {vehicle.capacity} pasajeros</small></span><select aria-label={`Estado de ${vehicle.plate}`} value={vehicle.state} disabled={busy} onChange={(event) => void setVehicleState(vehicle, event.target.value as ManagedVehicle["state"])} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-[10px] text-white"><option value="ACTIVO">Activo</option><option value="MANTENIMIENTO">Mantenimiento</option><option value="DE_BAJA">De baja</option></select></div></div>)}</div>
          </div>
        </section>
      )}

      {can(PERMISSIONS.AGENCY_MANAGE) && (
        <section className={panelClass}><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-emerald-400" /><h3 className="font-black text-white">Agencias</h3></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{agencies.map((agency) => <article key={agency.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><b className="text-sm text-white">{agency.code} · {agency.city}</b><p className="text-xs text-slate-400">{agency.name}</p><p className="mt-1 text-[10px] text-slate-500">{agency.address}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setEditingAgency(agency)} className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-slate-300">Editar</button><button disabled={busy} onClick={() => void toggleAgency(agency)} className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${agency.isActive ? "border-rose-500/30 text-rose-300" : "border-emerald-500/30 text-emerald-300"}`}>{agency.isActive ? "Desactivar" : "Activar"}</button></div></article>)}</div>{editingAgency && <form action={(data) => void saveAgency(data)} className="mt-4 grid gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 sm:grid-cols-2 lg:grid-cols-3"><p className="sm:col-span-2 lg:col-span-3 text-xs font-black uppercase text-emerald-300">Editar {editingAgency.name}</p><label className="text-xs font-bold">Código<input name="code" defaultValue={editingAgency.code} required className={inputClass} /></label><label className="text-xs font-bold">Nombre<input name="name" defaultValue={editingAgency.name} required className={inputClass} /></label><label className="text-xs font-bold">Ciudad<input name="city" defaultValue={editingAgency.city} required className={inputClass} /></label><label className="text-xs font-bold sm:col-span-2">Dirección<input name="address" defaultValue={editingAgency.address} required className={inputClass} /></label><label className="text-xs font-bold">Teléfono<input name="phone" defaultValue={editingAgency.phone} className={inputClass} /></label><label className="text-xs font-bold">Correo<input name="email" type="email" defaultValue={editingAgency.email} className={inputClass} /></label><div className="flex items-end gap-2"><button disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white">Guardar</button><button type="button" onClick={() => setEditingAgency(null)} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold">Cancelar</button></div></form>}</section>
      )}

      {can(PERMISSIONS.AUDIT_VIEW) && (
        <section className={panelClass}><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-400" /><h3 className="font-black text-white">Auditoría y seguridad</h3></div><div className="mt-4 max-h-96 overflow-auto"><table className="min-w-full text-xs"><thead><tr className="border-b border-white/10 text-left text-[10px] uppercase text-slate-500"><th className="p-2">Fecha</th><th className="p-2">Usuario</th><th className="p-2">Acción</th><th className="p-2">Entidad</th><th className="p-2">Agencia</th></tr></thead><tbody>{audit.map((entry) => <tr key={entry.id} className="border-b border-white/5 text-slate-300"><td className="p-2 whitespace-nowrap">{formatDate(entry.createdAt)}</td><td className="p-2">{entry.username}</td><td className="p-2 font-mono text-emerald-300">{entry.action}</td><td className="p-2">{entry.entity} {entry.entityId}</td><td className="p-2">{entry.agencyName}</td></tr>)}</tbody></table></div></section>
      )}
    </div>
  );
}

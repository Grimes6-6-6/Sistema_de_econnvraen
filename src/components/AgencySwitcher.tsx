"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Building2, Plus, X } from "lucide-react";
import { useDatabase } from "@/context/DatabaseContext";
import type { Agency } from "@/lib/domain/agency";

interface ApiError {
  error?: { message?: string };
}

function trapDialogFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function errorMessage(payload: unknown): string {
  const candidate = payload as ApiError | null;
  return candidate?.error?.message || "No se pudo completar la operación.";
}

export default function AgencySwitcher() {
  const { currentUser } = useDatabase();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/agencies", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as
          | { agencies?: Agency[] }
          | ApiError;
        if (!response.ok) throw new Error(errorMessage(payload));
        if (!cancelled && "agencies" in payload) {
          setAgencies(payload.agencies || []);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudieron cargar las agencias.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!currentUser) return null;

  const switchAgency = async (agencyId: string) => {
    if (!agencyId || agencyId === currentUser.agenciaId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/agency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencyId }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw new Error(errorMessage(payload));
      window.location.reload();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo cambiar de agencia.",
      );
      setBusy(false);
    }
  };

  const createAgency = async (formData: FormData) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: formData.get("code"),
          name: formData.get("name"),
          city: formData.get("city"),
          address: formData.get("address"),
          phone: formData.get("phone"),
          email: formData.get("email"),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { agency?: Agency }
        | ApiError
        | null;
      if (!response.ok || !payload || !("agency" in payload) || !payload.agency) {
        throw new Error(errorMessage(payload));
      }
      setAgencies((current) =>
        [...current, payload.agency!].sort((left, right) =>
          left.city.localeCompare(right.city),
        ),
      );
      setShowCreate(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo crear la agencia.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-xl border border-[#d6c7b2] bg-[#fffaf2] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-[#8b641d]" />
        <div className="min-w-0 grow">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-600">
            {currentUser.rol === "SUPER_ADMIN"
              ? "Agencia operativa"
              : "Agencia activa"}
          </p>
          {currentUser.rol === "SUPER_ADMIN" && (
            <p className="text-[9px] font-bold text-[#8b641d]">
              Vista global habilitada
            </p>
          )}
        </div>
        {currentUser.rol === "SUPER_ADMIN" && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-lg border border-[#c7a45a] p-1 text-[#8b641d] transition hover:bg-[#ead8ae] hover:text-stone-950"
            aria-label="Crear agencia"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <select
        value={currentUser.agenciaId || ""}
        onChange={(event) => void switchAgency(event.target.value)}
        disabled={busy || agencies.length === 0}
        className="w-full rounded-lg border border-[#d6c7b2] bg-white px-2 py-2 text-[11px] font-bold text-slate-800 outline-none focus:border-[#c7a45a] disabled:opacity-60"
        aria-label="Agencia activa"
      >
        {agencies.length === 0 && (
          <option value={currentUser.agenciaId || ""}>
            {currentUser.agenciaNombre || "Sin agencia asignada"}
          </option>
        )}
        {agencies.map((agency) => (
          <option key={agency.id} value={agency.id}>
            {agency.code} · {agency.city}
          </option>
        ))}
      </select>
      {error && <p role="alert" className="mt-2 text-[10px] text-red-400">{error}</p>}

      {showCreate && (
        <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <form
            action={(formData) => void createAgency(formData)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-agency-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") setShowCreate(false);
              trapDialogFocus(event);
            }}
            className="corporate-dialog w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-premium"
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 id="create-agency-title" className="text-lg font-black text-white">Nueva agencia</h2>
                <p className="text-xs text-slate-400">
                  Quedará disponible para asignar personal y operaciones.
                </p>
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => setShowCreate(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-300">
                Código
                <input
                  name="code"
                  required
                  minLength={2}
                  maxLength={20}
                  placeholder="PCH"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 uppercase text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="text-xs font-bold text-slate-300">
                Ciudad
                <input
                  name="city"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Pichari"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">
                Nombre
                <input
                  name="name"
                  required
                  minLength={3}
                  maxLength={100}
                  placeholder="Agencia Pichari"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="text-xs font-bold text-slate-300 sm:col-span-2">
                Dirección
                <input
                  name="address"
                  required
                  minLength={5}
                  maxLength={180}
                  placeholder="Av. Principal 123"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="text-xs font-bold text-slate-300">
                Teléfono
                <input
                  name="phone"
                  maxLength={20}
                  placeholder="966 000 000"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-emerald-500"
                />
              </label>
              <label className="text-xs font-bold text-slate-300">
                Correo
                <input
                  name="email"
                  type="email"
                  maxLength={150}
                  placeholder="pichari@empresa.pe"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-emerald-500"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="mt-5 w-full rounded-xl bg-blue-700 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-blue-600 disabled:opacity-60"
            >
              {busy ? "Guardando..." : "Crear agencia"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

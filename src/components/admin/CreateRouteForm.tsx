import { useRef, useState, type SubmitEvent } from "react";
import type { UserRole } from "@/lib/auth/types";
import { getRouteFormAgencyOptions } from "@/lib/domain/route-form";
import { managedRouteSchema, type ManagedRouteInput } from "@/lib/validation/schemas";
import { useFeedback } from "@/components/ui/FeedbackProvider";

interface RouteFormAgency {
  id: string;
  code: string;
  city: string;
  name: string;
}

interface CreateRouteFormProps {
  agencies: RouteFormAgency[];
  role: UserRole;
  activeAgencyId: string | null;
  busy: boolean;
  onCreateRoute: (input: ManagedRouteInput) => Promise<void>;
}

const inputClass =
  "mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-500 disabled:opacity-60";

export default function CreateRouteForm({
  agencies,
  role,
  activeAgencyId,
  busy,
  onCreateRoute,
}: CreateRouteFormProps) {
  const { notify } = useFeedback();
  const [originAgencyId, setOriginAgencyId] = useState("");
  const [destinationAgencyId, setDestinationAgencyId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submissionPending = useRef(false);
  const options = getRouteFormAgencyOptions(agencies, {
    role, activeAgencyId, originAgencyId, destinationAgencyId,
  });
  const unavailable = options.origins.length === 0 || options.destinations.length === 0;

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || submissionPending.current || unavailable) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = managedRouteSchema.safeParse({
      originAgencyId: data.get("originAgencyId"),
      destinationAgencyId: data.get("destinationAgencyId"),
      distanceKm: Number(data.get("distanceKm")),
      durationHours: Number(data.get("durationHours")),
      price: Number(data.get("price")),
      state: "ACTIVO",
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }

    submissionPending.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onCreateRoute(parsed.data);
      form.reset();
      setDestinationAgencyId("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Intenta nuevamente.";
      setError(message);
      notify({ type: "error", title: "No se pudo crear la ruta", message });
    } finally {
      submissionPending.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} aria-busy={submitting} className="mt-3 space-y-3">
      {role !== "SUPER_ADMIN" && (
        <p className="text-xs leading-relaxed text-slate-400">El origen corresponde a tu agencia activa.</p>
      )}
      {unavailable && (
        <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200">
          {options.origins.length === 0
            ? "No hay una agencia de origen activa disponible para tu usuario."
            : "Se necesitan al menos dos agencias activas para crear una ruta."}
        </p>
      )}
      <fieldset disabled={busy || submitting || unavailable} className="min-w-0 space-y-3">
        <legend className="sr-only">Datos de la nueva ruta</legend>
        <label className="block text-xs font-bold text-slate-300">
          Agencia de origen
          <select name="originAgencyId" value={options.originAgencyId} required
            onChange={(event) => { setOriginAgencyId(event.target.value); setDestinationAgencyId(""); }}
            className={inputClass}>
            <option value="" disabled>Selecciona el origen</option>
            {options.origins.map((agency) => <option key={agency.id} value={agency.id}>{agency.code} · {agency.city} · {agency.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-300">
          Agencia de destino
          <select name="destinationAgencyId" value={options.destinationAgencyId} required
            onChange={(event) => setDestinationAgencyId(event.target.value)} className={inputClass}>
            <option value="" disabled>Selecciona el destino</option>
            {options.destinations.map((agency) => <option key={agency.id} value={agency.id}>{agency.code} · {agency.city} · {agency.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-bold text-slate-300">
            Distancia (km)
            <input name="distanceKm" type="number" inputMode="decimal" min="0.01" max="5000" step="0.01" required placeholder="135.00" className={inputClass} />
          </label>
          <label className="block text-xs font-bold text-slate-300">
            Duración (horas)
            <input name="durationHours" type="number" inputMode="decimal" min="0.01" max="100" step="0.01" required placeholder="4.50" className={inputClass} />
          </label>
        </div>
        <label className="block text-xs font-bold text-slate-300">
          Precio base (S/)
          <input name="price" type="number" inputMode="decimal" min="0" max="100000" step="0.01" required placeholder="59.99" className={inputClass} />
        </label>
        <button type="submit" className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
          {submitting ? "Guardando ruta…" : "Guardar ruta"}
        </button>
      </fieldset>
      {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-200">{error}</p>}
    </form>
  );
}

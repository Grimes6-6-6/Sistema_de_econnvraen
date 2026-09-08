"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import type { InternalNotification } from "@/lib/domain/notifications";

export default function NotificationInbox({ onNavigate }: { onNavigate: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<InternalNotification[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const unread = items.filter((item) => !item.readAt).length;

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("No se pudieron actualizar los avisos. Comprueba tu conexión.");
      const payload = await response.json() as { notifications: InternalNotification[] };
      if (controller.signal.aborted) return;
      setItems(payload.notifications);
      setLoaded(true);
      setError("");
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudieron cargar los avisos.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const tick = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(tick, 60_000);
    window.addEventListener("online", tick);
    window.addEventListener("operational-documents-updated", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      activeRequest.current?.abort();
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.removeEventListener("online", tick);
      window.removeEventListener("operational-documents-updated", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  async function markRead(id: string) {
    setBusyId(id);
    try {
      const response = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("No se pudo guardar la lectura. Actualiza los avisos e intenta otra vez.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la lectura."); }
    finally { setBusyId(null); }
  }

  return <>
    <button type="button" onClick={() => { dialog.current?.showModal(); void refresh(); }} aria-label={`Avisos${loaded ? `: ${unread} sin leer` : ""}${error ? ". Actualización pendiente" : ""}`} className="relative flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-50">
      <Bell className="h-4.5 w-4.5" />
      {(unread > 0 || error) && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-700 px-1 text-center text-[10px] font-bold leading-5 text-white">{error ? "!" : unread > 99 ? "99+" : unread}</span>}
    </button>
    <dialog ref={dialog} aria-labelledby="notification-inbox-title" className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-stone-300 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-black/40">
      <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white p-4">
        <h2 id="notification-inbox-title" className="text-lg font-semibold">Avisos documentarios</h2>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Cerrar avisos" className="rounded-md p-2 hover:bg-stone-100"><X size={20} /></button>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-stone-600">Se revisan automáticamente cada minuto mientras el panel está abierto. Marcar como leído no resuelve la observación.</p>
        {error && <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{error} <button type="button" onClick={() => void refresh()} className="font-semibold underline">Reintentar</button></div>}
        {!loaded && !error && <p role="status">Cargando avisos…</p>}
        {loaded && !items.length && !error && <p className="py-6 text-center text-sm text-stone-600">No tienes avisos documentarios pendientes.</p>}
        {items.map((item) => <article key={item.id} className={`rounded-lg border p-3 ${item.readAt ? "border-stone-200 bg-stone-50" : "border-stone-300 bg-white"}`}>
          <p className={`text-xs font-semibold ${item.severity === "critical" ? "text-red-700" : item.severity === "warning" ? "text-amber-800" : "text-stone-600"}`}>{item.severity === "critical" ? "Urgente" : item.severity === "warning" ? "Atención" : "Información"}{item.readAt ? " · Leído" : " · Sin leer"}</p>
          <h3 className="mt-1 text-sm font-semibold">{item.title}</h3>
          <p className="mt-1 break-words text-sm text-stone-700">{item.message}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <button type="button" onClick={() => { dialog.current?.close(); onNavigate(); }} className="font-semibold underline underline-offset-2">Ver documentos</button>
            {!item.readAt && <button type="button" disabled={busyId !== null} onClick={() => void markRead(item.id)} className="flex items-center gap-1 text-stone-700 disabled:opacity-50"><Check size={14} />{busyId === item.id ? "Guardando…" : "Marcar como leído"}</button>}
          </div>
        </article>)}
      </div>
    </dialog>
  </>;
}

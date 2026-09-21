"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import type { Boleto, Ruta, Viaje } from "@/lib/domain/types";
import { formatPaymentMethod } from "@/lib/domain/payments";
import { getPeruWallClock, isTripOpenForBooking } from "@/lib/domain/trip-availability";
import { formatTicketSaleDate, ticketsSoldOn, type TicketHistoryItem, type TicketHistoryResult } from "@/lib/domain/ticket-sales";

interface Props {
  tickets: Boleto[];
  trips: Viaje[];
  routes: Ruta[];
  canCancel: boolean;
  canApproveCancellation: boolean;
  pendingAction: string | null;
  onCancel: (ticket: Boleto) => Promise<void>;
}

const EMPTY_FILTERS = { search: "", from: "", to: "", state: "" };

export default function TicketSalesHistory({
  tickets, trips, routes, canCancel, canApproveCancellation, pendingAction, onCancel,
}: Props) {
  const [mode, setMode] = useState<"today" | "history">("today");
  const [today, setToday] = useState(() => getPeruWallClock().date);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [response, setResponse] = useState<{
    key: string; data?: TicketHistoryResult; error?: string;
  } | null>(null);
  const query = new URLSearchParams({ ...filters, page: String(page) }).toString();
  const requestKey = `${query}:${retry}`;

  useEffect(() => {
    const timer = window.setInterval(() => setToday(getPeruWallClock().date), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (mode !== "history") return;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await fetch(`/api/tickets?${query}`, {
          cache: "no-store", signal: controller.signal,
        });
        const body = await result.json();
        if (!result.ok) throw new Error(
          typeof body.error?.message === "string" ? body.error.message : "No se pudo consultar el historial.",
        );
        if (!controller.signal.aborted) setResponse({ key: requestKey, data: body });
      } catch (error) {
        if (controller.signal.aborted) return;
        setResponse({ key: requestKey, error: error instanceof Error ? error.message : "No se pudo consultar el historial." });
      }
    }
    void load();
    return () => controller.abort();
  }, [mode, query, requestKey, tickets]);

  const todayTickets = useMemo(() => ticketsSoldOn(tickets, today), [tickets, today]);
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const isHistory = mode === "history";
  const currentResponse = response?.key === requestKey ? response : null;
  const data = currentResponse?.data;
  const loading = isHistory && !currentResponse;
  const error = isHistory ? currentResponse?.error : undefined;
  const rows: TicketHistoryItem[] = isHistory ? (data?.items || []) : todayTickets.slice(0, 10).map((ticket) => {
    const trip = tripById.get(ticket.id_viaje);
    const route = trip && routeById.get(trip.id_ruta);
    return {
      ...ticket,
      ruta: route ? `${route.origen} → ${route.destino}` : ticket.id_viaje,
      salida: trip ? `${trip.fecha} ${trip.hora}` : "",
    };
  });
  const total = isHistory ? (data?.total || 0) : todayTickets.length;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function showTodayHistory() {
    const next = { ...EMPTY_FILTERS, from: today, to: today };
    setDraft(next);
    setFilters(next);
    setPage(1);
    setMode("history");
  }

  return (
    <section className="no-print rounded-2xl border border-[#ddd2c2] bg-[#fffdf8] p-4 sm:p-6 shadow-sm space-y-4" aria-label="Ventas de boletos">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-base text-slate-800">
            {isHistory ? "Historial de boletos vendidos" : "Boletos vendidos hoy"}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {isHistory ? "Consulta ventas anteriores por fecha de emisión." : `${formatTicketSaleDate(today)} · Ventas registradas hoy, en horario de Perú.`}
          </p>
        </div>
        <div className="flex gap-2" aria-label="Seleccionar vista de boletos">
          <button type="button" aria-pressed={!isHistory} onClick={() => setMode("today")}
            className={`min-h-11 rounded-lg border px-4 text-sm font-semibold ${!isHistory ? "bg-[#3b352f] text-[#ffffff] border-[#3b352f]" : "bg-white text-slate-700 border-slate-300"}`}>
            Hoy
          </button>
          <button type="button" aria-pressed={isHistory} onClick={() => setMode("history")}
            className={`min-h-11 rounded-lg border px-4 text-sm font-semibold flex items-center gap-2 ${isHistory ? "bg-[#3b352f] text-[#ffffff] border-[#3b352f]" : "bg-white text-slate-700 border-slate-300"}`}>
            <History className="h-4 w-4" /> Historial
          </button>
        </div>
      </div>

      {isHistory && (
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" onSubmit={(event) => {
          event.preventDefault(); setFilters(draft); setPage(1); setRetry((value) => value + 1);
        }}>
          <label className="text-xs font-semibold text-slate-600 xl:col-span-2">
            Código, pasajero, DNI o ruta
            <input type="search" maxLength={100} value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              placeholder="Buscar boleto…" className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 px-3 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Emitidos desde
            <input type="date" value={draft.from} max={draft.to || undefined} onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 px-3 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Emitidos hasta
            <input type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 px-3 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Estado
            <select value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value })}
              className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="">Todos</option><option value="activo">Activo</option><option value="anulado">Anulado</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-5">
            <button type="submit" className="min-h-11 rounded-lg bg-[#3b352f] px-4 text-sm font-semibold text-[#ffffff] flex items-center gap-2">
              <Search className="h-4 w-4" /> Buscar
            </button>
            <button type="button" onClick={() => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(1); }}
              className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">Limpiar filtros</button>
          </div>
        </form>
      )}

      <div aria-live="polite" className="text-xs text-slate-500">
        {loading ? "Consultando boletos…" : !error && `${total} boleto${total === 1 ? "" : "s"} ${isHistory ? "encontrados" : "emitidos hoy"}`}
      </div>
      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 p-4 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="ml-3 underline min-h-11">Reintentar</button>
        </div>
      ) : (
        <div className="overflow-x-auto" aria-busy={loading}>
          <table className="min-w-full text-xs">
            <caption className="sr-only">{isHistory ? "Historial de ventas filtrado por fecha de emisión" : "Últimas diez ventas del día"}</caption>
            <thead className="bg-slate-50 text-slate-500">
              <tr>{["Código / emisión", "Pasajero / DNI", "Viaje / salida", "Asiento", "Precio", "Pago", "Estado", "Acción"].map((heading) => (
                <th key={heading} scope="col" className="border-b py-3 px-3 text-left font-semibold whitespace-nowrap">{heading}</th>
              ))}</tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-slate-500">
                  {isHistory ? "No hay boletos que coincidan con los filtros." : "Todavía no se han vendido boletos hoy. Consulta las ventas anteriores en Historial."}
                </td></tr>
              )}
              {rows.map((ticket) => {
                const trip = tripById.get(ticket.id_viaje);
                return (
                  <tr key={ticket.id} className="border-b last:border-0 text-slate-700">
                    <td className="py-3 px-3 whitespace-nowrap"><span className="font-mono font-semibold">{ticket.codigo}</span><small className="block text-slate-500 mt-1">{formatTicketSaleDate(ticket.fechaEmision)}</small></td>
                    <td className="py-3 px-3"><span className="font-semibold">{ticket.pasajeroNombres} {ticket.pasajeroApellidos}</span><small className="block font-mono text-slate-500 mt-1">{ticket.pasajeroDni}</small></td>
                    <td className="py-3 px-3"><span>{ticket.ruta}</span><small className="block text-slate-500 mt-1">{formatTicketSaleDate(ticket.salida)}</small></td>
                    <td className="py-3 px-3 font-semibold">A{ticket.asiento}</td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono">S/ {ticket.precio.toFixed(2)}</td>
                    <td className="py-3 px-3">{formatPaymentMethod(ticket.metodoPago)}{ticket.referenciaPago && <small className="block text-slate-500 mt-1">Op. {ticket.referenciaPago}</small>}</td>
                    <td className="py-3 px-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${ticket.estado === "anulado" ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>{ticket.estado === "anulado" ? "Anulado" : "Activo"}</span></td>
                    <td className="py-3 px-3">
                      {ticket.estado !== "anulado" && canCancel && trip && isTripOpenForBooking(trip) && (
                        <button type="button" onClick={() => void onCancel(ticket)} disabled={pendingAction !== null}
                          className="min-h-11 rounded-lg px-2 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap">
                          {pendingAction === `cancel-ticket-${ticket.id}` ? "Procesando…" : canApproveCancellation ? "Anular" : "Solicitar anulación"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!isHistory && todayTickets.length > 10 && (
        <button type="button" onClick={showTodayHistory} className="min-h-11 text-sm font-semibold underline text-slate-700">Ver todos los boletos de hoy ({todayTickets.length})</button>
      )}
      {isHistory && data && !loading && !error && data.total > 0 && (
        <div className="flex flex-wrap justify-between items-center gap-3 text-xs text-slate-600">
          <span>Mostrando {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} de {data.total}</span>
          <div className="flex items-center gap-3">
            <button type="button" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} className="min-h-11 border rounded-lg px-3 disabled:opacity-40">Anterior</button>
            <span>Página {data.page} de {totalPages}</span>
            <button type="button" disabled={data.page >= totalPages} onClick={() => setPage(data.page + 1)} className="min-h-11 border rounded-lg px-3 disabled:opacity-40">Siguiente</button>
          </div>
        </div>
      )}
    </section>
  );
}

import type { Boleto } from "./types";

export interface TicketHistoryItem extends Boleto {
  ruta: string;
  salida: string;
}

export interface TicketHistoryResult {
  items: TicketHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** fechaEmision is formatted by the server in America/Lima, not UTC. */
export function ticketsSoldOn(tickets: readonly Boleto[], date: string): Boleto[] {
  return tickets
    .filter((ticket) => ticket.fechaEmision.slice(0, 10) === date)
    .sort((left, right) =>
      right.fechaEmision.localeCompare(left.fechaEmision) ||
      right.codigo.localeCompare(left.codigo),
    );
}

export function formatTicketSaleDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(value);
  if (!match) return "—";
  return `${match[3]}/${match[2]}/${match[1]}${match[4] ? ` · ${match[4]}` : ""}`;
}

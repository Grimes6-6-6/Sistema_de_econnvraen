import type { OperationalDocument } from "./admin";

export interface InternalNotification {
  id: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  href: string;
  readAt: string | null;
}

export function documentNotificationCandidates(documents: OperationalDocument[], driver: boolean, today: string) {
  const latest = new Map<string, OperationalDocument>();
  for (const document of documents) {
    const key = `${document.holderType}:${document.holderId}:${document.documentType}`;
    const previous = latest.get(key);
    if (!previous || Number(document.id.slice(3)) > Number(previous.id.slice(3))) latest.set(key, document);
  }
  return [...latest.values()].flatMap((document) => {
    const days = Math.round((Date.parse(`${document.expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const bucket = days < 0 ? "expired" : days <= 7 ? "week" : days <= 30 ? "month" : "current";
    const pending = document.state === "PENDIENTE";
    const observed = document.state === "OBSERVADO";
    if (bucket === "current" && !pending && !observed && !driver) return [];
    const title = days < 0 ? "Documento vencido" : days <= 30 ? "Documento próximo a vencer" : observed ? "Documento observado" : pending ? "Documento pendiente de revisión" : "Documento validado";
    const severity: InternalNotification["severity"] = days < 0 ? "critical" : days <= 7 || observed ? "warning" : "info";
    const message = `${document.holderName} · ${document.documentType}. ${days < 0 ? "Venció" : "Vence"} el ${document.expiresAt}.${pending ? " Pendiente de revisión." : observed ? ` Observación: ${document.notes || "Revisa el archivo enviado."}` : ""}`;
    return [{
      key: JSON.stringify([document.id, document.state, document.expiresAt, document.notes, bucket]),
      title, message, severity,
      href: driver ? "/conductor#documentos" : "/dashboard#documentos",
    }];
  });
}

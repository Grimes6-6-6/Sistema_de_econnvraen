"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  ClipboardList,
  Package,
  Search,
  ShieldCheck,
  Truck,
  MapPin,
  Clock,
  QrCode,
} from "lucide-react";
import ParcelQrScanner from "@/components/ParcelQrScanner";
import { extractParcelTrackingCode } from "@/lib/domain/parcel-receipt";
import type { PublicTrackingResult } from "@/lib/domain/types";

const TRACKING_STEPS = [
  { key: "registrado", label: "Registrado" },
  { key: "en_transito", label: "En Tránsito" },
  { key: "en_destino", label: "En Destino" },
  { key: "entregado", label: "Entregado" },
] as const;

function getStepIndex(estado: string): number {
  if (estado === "recojo_domicilio" || estado === "registrado") return 0;
  if (estado === "en_transito") return 1;
  if (estado === "en_destino") return 2;
  if (estado === "entregado") return 3;
  return 0;
}

export default function PublicClientPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [result, setResult] = useState<PublicTrackingResult | null>(null);
  const [error, setError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState("");

  useEffect(() => {
    const trackingCode = new URLSearchParams(window.location.search)
      .get("tracking")
      ?.trim()
      .toUpperCase();
    if (trackingCode && /^ECV-\d{6}-\d{5}$/.test(trackingCode)) {
      const timer = window.setTimeout(() => setQuery(trackingCode), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const closeQrScanner = useCallback(() => setIsQrScannerOpen(false), []);
  const handleQrScanned = useCallback((value: string) => {
    const trackingCode = extractParcelTrackingCode(value);
    if (!trackingCode) return;

    setQuery(trackingCode);
    setResult(null);
    setError("");
    setScanMessage(
      "QR leído correctamente. Completa los últimos 4 dígitos del DNI para consultar.",
    );
  }, []);

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trackingCode = query.trim().toUpperCase();

    if (!/^ECV-\d{6}-\d{5}$/.test(trackingCode)) {
      setError("Ingresa un código válido, por ejemplo ECV-260714-00001.");
      setResult(null);
      return;
    }

    if (!/^\d{4}$/.test(securityCode)) {
      setError("Ingresa los últimos 4 dígitos del DNI del destinatario.");
      setResult(null);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingCode,
          recipientDniLast4: securityCode,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { item?: PublicTrackingResult; error?: { message?: string } }
        | null;

      if (!response.ok || !payload?.item) {
        throw new Error(
          payload?.error?.message ||
            "No encontramos coincidencias para tu búsqueda.",
        );
      }

      setResult(payload.item);
      setError("");
    } catch (searchError) {
      setResult(null);
      setError(
        searchError instanceof Error
          ? searchError.message
          : "No encontramos coincidencias para tu búsqueda.",
      );
    } finally {
      setIsSearching(false);
    }
  };

  const activeStepIdx = result ? getStepIndex(result.estado) : 0;

  return (
    <main className="corporate-public min-h-screen overflow-hidden text-slate-800 flex flex-col justify-between">
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-8 lg:px-10 justify-between">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/econnvrae-logo.png"
              alt="ECONNVRAE"
              width={2086}
              height={754}
              priority
              className="h-10 w-auto max-w-32 object-contain object-left sm:h-12 sm:max-w-40"
            />
            <div>
              <p className="hidden text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:block">
                Rastreo Público de Envíos
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => router.push("/login")}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2 text-xs font-bold text-slate-300 transition hover:border-emerald-500/40 hover:bg-slate-800 hover:text-white cursor-pointer backdrop-blur-md"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Acceso interno
          </button>
        </header>

        {/* Hero & Search Content */}
        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-12 lg:gap-12">
          {/* Left Column: Information */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
              <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
              Consulta pública de encomiendas
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold leading-tight tracking-tight text-slate-900">
              Consulta el estado de tu encomienda
            </h1>
            <p className="text-sm sm:text-base leading-relaxed text-slate-300 font-medium">
              Revisa el último estado registrado de tu envío entre Ayacucho y los distritos del VRAEM.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="glass-container-dark rounded-2xl p-4 border border-white/5 space-y-1">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Protección Anti-Fraude</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Verificación obligatoria de 4 dígitos para confidencialidad.
                </p>
              </div>

              <div className="glass-container-dark rounded-2xl p-4 border border-white/5 space-y-1">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <Truck className="h-4 w-4" />
                  <span>Ruta VRAEM Directa</span>
                </div>
                <p className="text-[11px] text-slate-400">
                    Actualización registrada en terminales y puntos de control.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Search Card & Stepper */}
          <div className="lg:col-span-6">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 sm:p-8 shadow-premium backdrop-blur-2xl space-y-6">
              <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Search className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-white">
                    Consultar Estado
                  </h2>
                  <p className="text-xs text-slate-400 font-medium">
                    Ingresa los datos para localizar tu paquete
                  </p>
                </div>
              </div>

              <form onSubmit={handleSearch} className="space-y-4">
                <button
                  type="button"
                  onClick={() => {
                    setScanMessage("");
                    setIsQrScannerOpen(true);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3.5 text-xs font-black uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  <QrCode className="h-4 w-4" />
                  Escanear QR del recibo
                </button>

                <div className="flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-white/10" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    o escribe el código
                  </span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="tracking-code" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                    Código de Tracking *
                  </label>
                  <div className="relative">
                    <Package className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="tracking-code"
                      type="text"
                      required
                      value={query}
                      onChange={(event) =>
                        setQuery(event.target.value.toUpperCase())
                      }
                      placeholder="ECV-260714-00001"
                      autoComplete="off"
                      maxLength={16}
                      className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-4 py-3 pl-10 text-sm font-mono font-bold tracking-wider text-emerald-300 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all uppercase"
                    />
                  </div>
                </div>

                {scanMessage && (
                  <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-200">
                    {scanMessage}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="tracking-security-code" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                    Últimos 4 dígitos del DNI destinatario *
                  </label>
                  <input
                    id="tracking-security-code"
                    type="text"
                    required
                    value={securityCode}
                    onChange={(event) =>
                      setSecurityCode(
                        event.target.value.replace(/\D/g, "").slice(0, 4),
                      )
                    }
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    placeholder="••••"
                    className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-4 py-3 text-sm font-mono font-bold tracking-[0.4em] text-center text-white placeholder:text-slate-600 placeholder:tracking-normal focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
                  />
                </div>

                {error && (
                  <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-300 flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSearching}
                  aria-busy={isSearching}
                  className="w-full rounded-xl bg-linear-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-extrabold text-xs uppercase tracking-widest py-3.5 flex justify-center items-center gap-2 shadow-lg shadow-emerald-950/50 hover:shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Search className="h-4 w-4" />
                  {isSearching ? "Buscando paquete..." : "Consultar Encomienda"}
                </button>
              </form>

              {/* Stepper Timeline Result */}
              {result && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-5 animate-fade-in">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block">
                        Código Encontrado
                      </span>
                      <p className="font-mono font-black text-lg text-white">
                        {result.codigo_tracking}
                      </p>
                    </div>
                    <span className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
                      {result.estado.replaceAll("_", " ")}
                    </span>
                  </div>

                  {/* Visual Stepper */}
                  <div className="grid grid-cols-4 gap-1 text-center pt-2">
                    {TRACKING_STEPS.map((step, idx) => {
                      const isReached = idx <= activeStepIdx;
                      return (
                        <div key={step.key} className="flex flex-col items-center space-y-1.5">
                          <div
                            className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                              isReached
                                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/40 font-black"
                                : "bg-slate-800 border border-white/10 text-slate-500"
                            }`}
                          >
                            {idx + 1}
                          </div>
                          <span
                            className={`text-[9px] font-extrabold uppercase tracking-tighter ${
                              isReached ? "text-emerald-300" : "text-slate-600"
                            }`}
                          >
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-white/10 text-xs">
                    <div className="flex items-start gap-2 bg-slate-950/60 p-3 rounded-xl border border-white/5">
                      <MapPin className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">
                          Última Ubicación
                        </span>
                        <p className="text-white font-bold">{result.ultimaUbicacion}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2 bg-slate-950/60 p-3 rounded-xl border border-white/5">
                      <Clock className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">
                          Última Actualización
                        </span>
                        <p className="text-white font-bold">{result.ultimaActualizacion}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-white/10 pt-3">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                      Historial de estados
                    </h3>
                    <ol className="space-y-2">
                      {result.historial.map((event, index) => (
                        <li
                          key={`${event.fecha}-${event.estado}-${index}`}
                          className="flex gap-3 rounded-xl border border-white/5 bg-slate-950/50 p-3 text-xs"
                        >
                          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
                          <div>
                            <p className="font-black uppercase text-emerald-300">
                              {event.estado.replaceAll("_", " ")}
                            </p>
                            <p className="text-slate-300">{event.ubicacion}</p>
                            <time className="text-[10px] text-slate-500">
                              {event.fecha}
                            </time>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}

              {!result && (
                <div className="flex items-center gap-2 text-xs text-slate-500 justify-center pt-2">
                  <ClipboardList className="h-4 w-4 text-slate-400" />
                  <span>Información protegida bajo normativa de privacidad</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/5 py-4 flex flex-col sm:flex-row justify-between items-center text-xs text-slate-500 gap-2">
          <span>© 2026 ECONNVRAE S.A.C. · Todos los derechos reservados.</span>
          <span>Consulta protegida por validación de identidad</span>
        </footer>
      </div>

      {isQrScannerOpen && (
        <ParcelQrScanner
          onClose={closeQrScanner}
          onCodeScanned={handleQrScanned}
        />
      )}
    </main>
  );
}

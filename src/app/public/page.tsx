"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Package,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react";
import type { PublicTrackingResult } from "@/lib/domain/types";

export default function PublicClientPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const [result, setResult] = useState<PublicTrackingResult | null>(null);
  const [error, setError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

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

  return (
    <main className="min-h-screen overflow-hidden bg-[#07131a] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(45,212,191,0.20),transparent_30%),radial-gradient(circle_at_85%_70%,rgba(14,165,233,0.16),transparent_32%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-teal-300/40 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Volver al acceso
          </button>
          <div className="hidden items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-teal-200 sm:flex">
            <Truck className="h-4 w-4" aria-hidden="true" />
            Ayacucho · VRAEM
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.08fr_0.92fr] lg:py-20">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-teal-200">
              <Package className="h-3.5 w-3.5" aria-hidden="true" />
              Seguimiento público
            </div>
            <h1 className="max-w-2xl text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-6xl">
              Tu envío, claro y
              <span className="block text-teal-300">en cada tramo.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              Consulta el estado de tu encomienda sin exponer tus datos. Solo
              necesitas el código de tracking y una verificación privada.
            </p>

            <div className="mt-8 flex flex-wrap gap-3 text-xs font-semibold text-slate-300">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-teal-300" aria-hidden="true" />
                Consulta protegida
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2">
                <CheckCircle2 className="h-4 w-4 text-sky-300" aria-hidden="true" />
                Información mínima
              </span>
            </div>
          </div>

          <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-7">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-teal-300/10 p-3 text-teal-200">
                <Search className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-teal-200">
                  Consulta tu envío
                </p>
                <h2 className="mt-1 text-2xl font-black text-white">
                  ¿Dónde está ahora?
                </h2>
              </div>
            </div>

            <form onSubmit={handleSearch} className="mt-7 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Código de tracking
                </span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value.toUpperCase())}
                  placeholder="ECV-260714-00001"
                  autoComplete="off"
                  maxLength={15}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-sm font-semibold tracking-wide text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/60 focus:ring-4 focus:ring-teal-300/10"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Últimos 4 del DNI del destinatario
                </span>
                <input
                  value={securityCode}
                  onChange={(event) =>
                    setSecurityCode(
                      event.target.value.replace(/\D/g, "").slice(0, 4),
                    )
                  }
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="0000"
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 text-sm font-semibold tracking-[0.35em] text-white outline-none transition placeholder:tracking-normal placeholder:text-slate-500 focus:border-teal-300/60 focus:ring-4 focus:ring-teal-300/10"
                />
              </label>

              {error ? (
                <p
                  role="alert"
                  className="rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSearching}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-300 px-4 py-3.5 text-sm font-black text-slate-950 transition hover:bg-teal-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-300/30 disabled:cursor-wait disabled:opacity-60"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                {isSearching ? "Consultando…" : "Consultar estado"}
              </button>
            </form>

            {result ? (
              <div className="mt-6 rounded-2xl border border-teal-300/20 bg-teal-300/[0.08] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-100/70">
                      Estado actual
                    </p>
                    <p className="mt-1 font-mono text-lg font-black text-white">
                      {result.codigo_tracking}
                    </p>
                  </div>
                  <span className="rounded-full bg-teal-300 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-950">
                    {result.estado.replaceAll("_", " ")}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-400">Última ubicación</dt>
                    <dd className="mt-1 font-semibold text-white">
                      {result.ultimaUbicacion}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Actualización</dt>
                    <dd className="mt-1 font-semibold text-white">
                      {result.ultimaActualizacion}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="mt-6 flex items-start gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-3 text-sm leading-6 text-slate-400">
                <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" aria-hidden="true" />
                No mostramos nombres, DNI completos ni envíos recientes.
              </div>
            )}
          </section>
        </section>

        <footer className="border-t border-white/10 py-5 text-xs text-slate-500">
          ECONNVRAE · Transporte y encomiendas con seguimiento responsable.
        </footer>
      </div>
    </main>
  );
}

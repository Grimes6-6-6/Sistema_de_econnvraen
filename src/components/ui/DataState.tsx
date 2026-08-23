"use client";

import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";

export function InitialDataLoading() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4" role="status">
      <div className="text-center">
        <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-emerald-400" />
        <h1 className="mt-5 text-xl font-black text-white">Preparando el sistema</h1>
        <p className="mt-2 text-sm text-slate-400">Cargando la información de la agencia…</p>
      </div>
    </main>
  );
}

export function DataLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <section
        className="w-full max-w-lg rounded-3xl border border-amber-400/20 bg-slate-900/90 p-7 text-center shadow-2xl"
        role="alert"
      >
        <AlertTriangle className="mx-auto h-11 w-11 text-amber-300" />
        <h1 className="mt-4 text-xl font-black text-white">No pudimos cargar los datos</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-black text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
      </section>
    </main>
  );
}

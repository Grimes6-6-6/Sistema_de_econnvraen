"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error", {
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <section
        role="alert"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-premium"
      >
        <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-amber-400">
          ECONNVRAE
        </p>
        <h1 className="text-2xl font-bold text-slate-900">
          No pudimos cargar esta sección
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          El error fue registrado sin mostrar información interna. Intenta
          nuevamente o vuelve al inicio.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800"
          >
            Intentar nuevamente
          </button>
          <Link
            href="/"
            className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            Ir al inicio
          </Link>
        </div>
      </section>
    </main>
  );
}

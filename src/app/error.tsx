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
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <section
        role="alert"
        className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl"
      >
        <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-amber-400">
          ECONNVRAE
        </p>
        <h1 className="text-2xl font-black text-white">
          No pudimos cargar esta sección
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          El error fue registrado sin mostrar información interna. Intenta
          nuevamente o vuelve al inicio.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-400"
          >
            Intentar nuevamente
          </button>
          <Link
            href="/"
            className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-black text-slate-200 transition hover:border-slate-500"
          >
            Ir al inicio
          </Link>
        </div>
      </section>
    </main>
  );
}

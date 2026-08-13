export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-slate-950 px-6"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div
          aria-hidden="true"
          className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-400"
        />
        <p className="text-sm font-semibold text-slate-300">
          Cargando ECONNVRAE…
        </p>
      </div>
    </main>
  );
}

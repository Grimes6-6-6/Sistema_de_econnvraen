export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-slate-100 px-6"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div
          aria-hidden="true"
          className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-emerald-700"
        />
        <p className="text-sm font-semibold text-slate-600">
          Cargando ECONNVRAE…
        </p>
      </div>
    </main>
  );
}

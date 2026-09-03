import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-premium">
        <p className="text-5xl font-black text-emerald-400">404</p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          Página no encontrada
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          La dirección solicitada no existe o ya no está disponible.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-lg bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800"
        >
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}

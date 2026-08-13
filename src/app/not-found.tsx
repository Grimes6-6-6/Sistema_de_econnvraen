import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
        <p className="text-5xl font-black text-emerald-400">404</p>
        <h1 className="mt-4 text-2xl font-black text-white">
          Página no encontrada
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          La dirección solicitada no existe o ya no está disponible.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-xl bg-emerald-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-400"
        >
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}

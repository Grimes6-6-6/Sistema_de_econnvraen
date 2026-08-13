"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  KeyRound,
  Lock,
  Navigation,
  PackageSearch,
  ShieldCheck,
  User,
} from "lucide-react";
import { useDatabase } from "@/context/DatabaseContext";

type LoginMode = "selector" | "operador" | "conductor";

export default function LoginPage() {
  const router = useRouter();
  const { loginUser } = useDatabase();
  const [loginMode, setLoginMode] = useState<LoginMode>("selector");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectRole = (mode: Exclude<LoginMode, "selector">) => {
    setError("");
    setUsername("");
    setPassword("");
    setLoginMode(mode);
  };

  const handleLoginSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const user = await loginUser(username, password);
      if (!user) throw new Error("Usuario o contraseña incorrectos.");
      router.replace(user.rol === "CONDUCTOR" ? "/conductor" : "/dashboard");
      router.refresh();
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "No se pudo iniciar sesión.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#07131a] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(45,212,191,0.18),transparent_30%),radial-gradient(circle_at_90%_85%,rgba(245,158,11,0.13),transparent_32%)]" />
      <div className="relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-12 px-5 py-10 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-12">
        <section className="max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-teal-200">
            <Bus className="h-4 w-4" aria-hidden="true" />
            ECONNVRAE
          </div>
          <h1 className="mt-6 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            Operación de ruta
            <span className="block text-teal-300">en un solo lugar.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300 sm:text-lg">
            Pasajes, encomiendas, viajes y entregas conectados a una plataforma
            diseñada para la ruta Ayacucho–VRAEM.
          </p>

          <div className="mt-8 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <ShieldCheck className="h-5 w-5 text-teal-300" aria-hidden="true" />
              <p className="mt-3 font-bold text-white">Acceso por roles</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Cada perfil recibe únicamente las operaciones autorizadas.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <Navigation className="h-5 w-5 text-amber-300" aria-hidden="true" />
              <p className="mt-3 font-bold text-white">Trabajo en ruta</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Manifiestos, seguimiento y entregas desde el móvil.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-slate-950/65 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
          {loginMode === "selector" ? (
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-teal-200">
                Selecciona tu acceso
              </p>
              <h2 className="mt-2 text-3xl font-black">
                ¿Qué deseas hacer hoy?
              </h2>
              <div className="mt-7 grid gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/public")}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-sky-300/40 hover:bg-sky-300/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  <span className="rounded-xl bg-sky-300/10 p-3 text-sky-300">
                    <PackageSearch className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-black text-white">
                      Consultar una encomienda
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-400">
                      Acceso público protegido con código y verificación.
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-1 group-hover:text-sky-300" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => selectRole("operador")}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-teal-300/40 hover:bg-teal-300/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
                >
                  <span className="rounded-xl bg-teal-300/10 p-3 text-teal-300">
                    <KeyRound className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-black text-white">
                      Personal de agencia
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-400">
                      Ventas, viajes, recojos, reportes y encomiendas.
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-1 group-hover:text-teal-300" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={() => selectRole("conductor")}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-amber-300/40 hover:bg-amber-300/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  <span className="rounded-xl bg-amber-300/10 p-3 text-amber-300">
                    <Navigation className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-black text-white">
                      Conductor de ruta
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-400">
                      Manifiesto, GPS, encomiendas y prueba de entrega.
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-1 group-hover:text-amber-300" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setLoginMode("selector")}
                className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Cambiar perfil
              </button>

              <div className="mt-7">
                <div
                  className={`inline-flex rounded-2xl p-3 ${
                    loginMode === "operador"
                      ? "bg-teal-300/10 text-teal-300"
                      : "bg-amber-300/10 text-amber-300"
                  }`}
                >
                  {loginMode === "operador" ? (
                    <KeyRound className="h-6 w-6" aria-hidden="true" />
                  ) : (
                    <Navigation className="h-6 w-6" aria-hidden="true" />
                  )}
                </div>
                <p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-slate-400">
                  Acceso seguro
                </p>
                <h2 className="mt-2 text-3xl font-black">
                  {loginMode === "operador"
                    ? "Panel de agencia"
                    : "Aplicación de ruta"}
                </h2>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100"
                >
                  {error}
                </p>
              ) : null}

              <form onSubmit={handleLoginSubmit} className="mt-7 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Usuario
                  </span>
                  <span className="relative block">
                    <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={50}
                      autoComplete="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.06] py-3.5 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/60 focus:ring-4 focus:ring-teal-300/10"
                      placeholder="Tu nombre de usuario"
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Contraseña
                  </span>
                  <span className="relative block">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      maxLength={128}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.06] py-3.5 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/60 focus:ring-4 focus:ring-teal-300/10"
                      placeholder="Tu contraseña"
                    />
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-black text-slate-950 transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-wait disabled:opacity-60 ${
                    loginMode === "operador"
                      ? "bg-teal-300 hover:bg-teal-200 focus-visible:ring-teal-300/30"
                      : "bg-amber-300 hover:bg-amber-200 focus-visible:ring-amber-300/30"
                  }`}
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  {isSubmitting ? "Verificando…" : "Iniciar sesión"}
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

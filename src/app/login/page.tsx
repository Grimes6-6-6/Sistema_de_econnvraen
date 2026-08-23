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
  Sparkles,
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
    <main className="relative flex min-h-screen items-center justify-center p-4 sm:p-6 lg:p-10 overflow-hidden">
      {/* Background Glow effects */}
      <div className="ambient-bg pointer-events-none">
        <div className="ambient-blob-1"></div>
        <div className="ambient-blob-2"></div>
        <div className="ambient-blob-3"></div>
      </div>

      <div className="relative z-10 w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 backdrop-blur-2xl shadow-premium grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
        {/* Left Side: Form Container */}
        <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-center">
          {/* Logo / Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-500 to-green-700 text-white shadow-lg border border-emerald-400/20">
              <Bus className="h-6 w-6" />
            </div>
            <div>
              <span className="text-xl font-black tracking-wider text-white flex items-center gap-2">
                ECONNVRAE
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Sistema Web
                </span>
              </span>
              <p className="text-[11px] text-slate-400 font-semibold tracking-wide">
                Transporte y Encomiendas Ayacucho - VRAEM
              </p>
            </div>
          </div>

          <div className="mt-8">
            {loginMode === "selector" ? (
              <div className="animate-fade-in space-y-6">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                    Bienvenido al Sistema
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-slate-400 font-medium">
                    Selecciona el módulo de acceso correspondiente:
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => router.push("/public")}
                    className="saas-card group flex w-full items-center gap-4 p-4 text-left cursor-pointer border border-white/5 hover:border-blue-500/40 hover:bg-slate-800/80 transition-all shadow-md"
                  >
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 text-blue-400 group-hover:scale-105 transition-transform shrink-0">
                      <PackageSearch className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-sm text-white group-hover:text-blue-300 transition-colors">
                        Consultar Encomienda
                      </h3>
                      <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">
                        Acceso público para clientes con código de rastreo
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-blue-400 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>

                  <button
                    onClick={() => selectRole("operador")}
                    className="saas-card group flex w-full items-center gap-4 p-4 text-left cursor-pointer border border-white/5 hover:border-emerald-500/40 hover:bg-slate-800/80 transition-all shadow-md"
                  >
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-emerald-400 group-hover:scale-105 transition-transform shrink-0">
                      <KeyRound className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-sm text-white group-hover:text-emerald-300 transition-colors">
                        Personal de Agencia
                      </h3>
                      <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">
                        Ventas de pasajes, manifiestos y control de encomiendas
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>

                  <button
                    onClick={() => selectRole("conductor")}
                    className="saas-card group flex w-full items-center gap-4 p-4 text-left cursor-pointer border border-white/5 hover:border-amber-500/40 hover:bg-slate-800/80 transition-all shadow-md"
                  >
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-amber-400 group-hover:scale-105 transition-transform shrink-0">
                      <Navigation className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-sm text-white group-hover:text-amber-300 transition-colors">
                        Portal de Conductores
                      </h3>
                      <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">
                        Viajes asignados, firmas de entrega, GPS e incidencias
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-amber-400 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="animate-slide-in-left space-y-5">
                <button
                  onClick={() => setLoginMode("selector")}
                  className="group inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                  Volver a seleccionar módulo
                </button>

                <div>
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                    {loginMode === "operador"
                      ? "Acceso de Agencia"
                      : "Acceso Conductor"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400 font-medium">
                    Ingresa tus credenciales autorizadas por la empresa
                  </p>
                </div>

                {error && (
                  <div role="alert" className="rounded-xl bg-red-500/10 p-3.5 text-xs font-bold text-red-300 border border-red-500/30 flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div className="space-y-1">
                      <label htmlFor="login-username" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      Usuario / DNI
                    </label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <input
                        id="login-username"
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-4 py-3 pl-10 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all font-medium"
                        placeholder="Ingresa tu usuario"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                      <label htmlFor="login-password" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      Contraseña
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <input
                        id="login-password"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-4 py-3 pl-10 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all font-medium"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    className="w-full rounded-xl bg-linear-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-extrabold text-xs uppercase tracking-widest py-3.5 flex justify-center items-center gap-2 shadow-lg shadow-emerald-950/50 hover:shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50 mt-2"
                  >
                    {isSubmitting ? "Autenticando..." : "Ingresar al Sistema"}
                    {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Hero Visual Panel */}
        <div className="lg:col-span-5 relative hidden lg:flex flex-col justify-between p-10 bg-linear-to-br from-emerald-950/80 via-slate-900/90 to-[#090d16] border-l border-white/10">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-black uppercase tracking-widest">
            <Sparkles className="h-4 w-4" />
            <span>Sistema Centralizado</span>
          </div>

          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/30 backdrop-blur-md text-emerald-300">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/30 backdrop-blur-md text-emerald-300">
                <Navigation className="h-6 w-6" />
              </div>
            </div>
            <h2 className="text-2xl xl:text-3xl font-black text-white leading-tight">
              Gestión Logística Inteligente
            </h2>
            <p className="text-xs xl:text-sm text-slate-300 font-medium leading-relaxed">
              Plataforma para la administración de encomiendas, pasajes, incidencias y ubicación GPS de la flota.
            </p>
          </div>

          <div className="pt-6 border-t border-white/5 flex justify-between items-center text-[10px] text-slate-500 font-bold tracking-wider uppercase">
            <span>Acceso protegido por roles</span>
            <span>Ayacucho — VRAEM</span>
          </div>
        </div>
      </div>
    </main>
  );
}

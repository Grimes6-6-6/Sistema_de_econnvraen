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

      if (
        loginMode === "operador" &&
        user.rol === "CONDUCTOR"
      ) {
        throw new Error(
          "Este usuario es conductor. Usa el acceso de Conductores.",
        );
      }

      if (
        loginMode === "conductor" &&
        user.rol !== "CONDUCTOR" &&
        user.rol !== "ADMINISTRADOR"
      ) {
        throw new Error(
          "Este usuario no tiene perfil de conductor. Usa Personal de Agencia.",
        );
      }

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
    <main className="flex min-h-screen bg-slate-50">
      {/* Left Side: Form Container */}
      <div className="flex w-full flex-col justify-center px-6 py-12 lg:w-1/2 lg:px-20 xl:px-32">
        <div className="mx-auto w-full max-w-sm">
          {/* Logo / Brand */}
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-700 text-white shadow-sm">
              <Bus className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              ECONNVRAE
            </span>
          </div>

          <div className="mt-8">
            {loginMode === "selector" ? (
              <div className="animate-fade-in">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  Bienvenido al Sistema
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Selecciona el módulo al que deseas ingresar
                </p>

                <div className="mt-8 space-y-4">
                  <button
                    onClick={() => router.push("/public")}
                    className="saas-card flex w-full items-center gap-4 p-4 text-left hover:border-blue-300 hover:ring-1 hover:ring-blue-300"
                  >
                    <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                      <PackageSearch className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">Consultar Encomienda</h3>
                      <p className="text-xs text-slate-500">Acceso público de rastreo</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </button>

                  <button
                    onClick={() => selectRole("operador")}
                    className="saas-card flex w-full items-center gap-4 p-4 text-left hover:border-emerald-300 hover:ring-1 hover:ring-emerald-300"
                  >
                    <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">Personal de Agencia</h3>
                      <p className="text-xs text-slate-500">Ventas, viajes y despachos</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </button>
                  
                  <button
                    onClick={() => selectRole("conductor")}
                    className="saas-card flex w-full items-center gap-4 p-4 text-left hover:border-amber-300 hover:ring-1 hover:ring-amber-300"
                  >
                    <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
                      <Navigation className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">Conductores (Web)</h3>
                      <p className="text-xs text-slate-500">Acceso alternativo web</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="animate-slide-in-left">
                <button
                  onClick={() => setLoginMode("selector")}
                  className="group mb-6 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
                >
                  <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                  Regresar
                </button>

                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  {loginMode === 'operador' ? 'Acceso Administrativo' : 'Acceso Conductor'}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Ingresa tus credenciales para continuar
                </p>

                {error && (
                  <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                    {error}
                  </div>
                )}

                <form onSubmit={handleLoginSubmit} className="mt-6 space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Usuario
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="saas-input w-full pl-10"
                        placeholder="Ingresa tu usuario"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Contraseña
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="saas-input w-full pl-10"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-primary w-full py-2.5 flex justify-center items-center gap-2 mt-4"
                  >
                    {isSubmitting ? "Autenticando..." : "Ingresar"}
                    {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Side: Visual/Branding (Hidden on mobile) */}
      <div className="relative hidden w-1/2 lg:block">
        <div className="absolute inset-0 bg-emerald-900">
          <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-30 mix-blend-overlay"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-emerald-900 via-emerald-900/40 to-transparent"></div>
        </div>
        
        <div className="absolute bottom-0 left-0 right-0 p-12 xl:p-20 text-white">
          <div className="flex gap-4 mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-md">
              <ShieldCheck className="h-6 w-6 text-emerald-100" />
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-md">
              <Navigation className="h-6 w-6 text-emerald-100" />
            </div>
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Gestión Logística Inteligente
          </h2>
          <p className="mt-4 max-w-xl text-lg text-emerald-100">
            Plataforma centralizada para la administración de encomiendas, pasajes y control de flota en la ruta Ayacucho - VRAEM.
          </p>
        </div>
      </div>
    </main>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Lock,
  Navigation,
  ShieldCheck,
  Smartphone,
  User,
} from "lucide-react";
import { useDatabase, type Usuario } from "@/context/DatabaseContext";

type AuthStage = "credentials" | "sms_verify";
type LoginPortal = "agency" | "driver";

const PORTAL_CONTENT = {
  agency: {
    badge: "Portal de agencia",
    eyebrow: "Personal administrativo",
    title: "Acceso de agencia",
    description:
      "Ingreso para superadministradores, administradores y operadores.",
    button: "Ingresar al panel de agencia",
    usernamePlaceholder: "Usuario de agencia",
    features: [
      "Itinerarios y venta de pasajes",
      "Encomiendas y recojos a domicilio",
      "Flota, reportes y administración",
    ],
  },
  driver: {
    badge: "Portal de conductores",
    eyebrow: "Personal en ruta",
    title: "Acceso de conductor",
    description:
      "Ingreso exclusivo para conductores registrados por la empresa.",
    button: "Ingresar al portal de conductor",
    usernamePlaceholder: "Usuario o DNI del conductor",
    features: [
      "Perfil y documentos personales",
      "Viajes y entregas asignadas",
      "Ubicación GPS e incidencias en ruta",
    ],
  },
} as const;

export default function LoginPage() {
  const router = useRouter();
  const { loginUser, verifySmsCode, resendSmsCode, logoutUser } = useDatabase();
  const [portal, setPortal] = useState<LoginPortal>("agency");
  const [authStage, setAuthStage] = useState<AuthStage>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [smsCode, setSmsCode] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const activePortal = PORTAL_CONTENT[portal];

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(
      () => setResendSeconds((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const selectPortal = (nextPortal: LoginPortal) => {
    if (nextPortal === portal) return;
    setPortal(nextPortal);
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setError("");
  };

  const routeAuthenticatedUser = (user: Usuario) => {
    router.replace(
      user.mustChangePassword
        ? "/change-password"
        : user.rol === "CONDUCTOR"
          ? "/conductor"
          : "/dashboard",
    );
    router.refresh();
  };

  const handleLoginSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const result = await loginUser(username, password);
      if ("user" in result) {
        routeAuthenticatedUser(result.user);
        return;
      }

      setPassword("");
      setSmsCode("");
      setMaskedPhone(result.maskedPhone);
      setResendSeconds(result.retryAfterSeconds);
      setAuthStage("sms_verify");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo iniciar sesión.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSmsSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const user = await verifySmsCode(smsCode);
      routeAuthenticatedUser(user);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo verificar el código.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSmsResend = async () => {
    setError("");
    setIsSubmitting(true);
    try {
      const result = await resendSmsCode();
      setMaskedPhone(result.maskedPhone);
      setResendSeconds(result.retryAfterSeconds);
      setSmsCode("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo reenviar el código.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const returnToCredentials = async () => {
    setIsSubmitting(true);
    try {
      await logoutUser();
    } finally {
      setAuthStage("credentials");
      setPassword("");
      setSmsCode("");
      setMaskedPhone("");
      setResendSeconds(0);
      setError("");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="corporate-login relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6 lg:p-10">
      <div className="login-card relative z-10 grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-premium lg:grid-cols-12">
        <section className="login-form-panel flex min-h-[620px] flex-col justify-center p-6 sm:p-10 lg:col-span-7 lg:p-12">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <Link
              href="/"
              aria-label="Volver a la página principal"
              className="block max-w-[70%]"
            >
              <Image
                src="/econnvrae-logo.png"
                alt="ECONNVRAE - Autos y camionetas al VRAEM"
                width={2086}
                height={754}
                priority
                className="h-16 w-auto max-w-full object-contain object-left"
              />
            </Link>
            <span className="rounded-md border border-[#dfc88f] bg-[#fff9e9] px-2.5 py-1 text-[10px] font-bold text-[#6b4f16]">
              {activePortal.badge}
            </span>
          </div>

          <div className="mt-7">
            {authStage === "credentials" ? (
              <div className="space-y-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a671d]">
                    Selecciona tu acceso
                  </p>
                  <div
                    className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5"
                    aria-label="Tipo de acceso"
                  >
                    <button
                      type="button"
                      aria-pressed={portal === "agency"}
                      onClick={() => selectPortal("agency")}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition ${
                        portal === "agency"
                          ? "border-[#d6b767] bg-white text-slate-900 shadow-sm"
                          : "border-transparent text-slate-500 hover:bg-white hover:text-slate-800"
                      }`}
                    >
                      <Building2 className="h-4 w-4" />
                      <span>Agencia</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={portal === "driver"}
                      onClick={() => selectPortal("driver")}
                      className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition ${
                        portal === "driver"
                          ? "border-[#d6b767] bg-white text-slate-900 shadow-sm"
                          : "border-transparent text-slate-500 hover:bg-white hover:text-slate-800"
                      }`}
                    >
                      <Navigation className="h-4 w-4" />
                      <span>Conductores</span>
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-[#8a671d]">
                    {activePortal.eyebrow}
                  </p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    {activePortal.title}
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {activePortal.description}
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                  >
                    {error}
                  </div>
                )}

                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="login-username"
                      className="block text-sm font-semibold text-slate-700"
                    >
                      Usuario
                    </label>
                    <div className="relative mt-1.5">
                      <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="login-username"
                        type="text"
                        required
                        autoFocus
                        autoCapitalize="none"
                        autoComplete="username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder={activePortal.usernamePlaceholder}
                        className="w-full border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#b78b2f] focus:ring-2 focus:ring-[#f2e3b7]"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="block text-sm font-semibold text-slate-700"
                    >
                      Contraseña
                    </label>
                    <div className="relative mt-1.5">
                      <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Escribe tu contraseña"
                        className="w-full border border-slate-300 bg-white py-3 pl-10 pr-12 text-sm text-slate-900 outline-none transition focus:border-[#b78b2f] focus:ring-2 focus:ring-[#f2e3b7]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        aria-label={
                          showPassword
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
                        }
                        aria-pressed={showPassword}
                        className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-[#b48729] bg-[#d8ad43] py-3.5 text-sm font-bold text-[#20180a] shadow-sm transition hover:bg-[#c99b32] focus:outline-none focus:ring-2 focus:ring-[#9f7622] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Comprobando acceso…" : activePortal.button}
                    {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                  </button>
                </form>

                <p className="border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
                  Si olvidaste tu acceso, solicítalo al administrador de tu agencia.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void returnToCredentials()}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Usar otra cuenta
                </button>

                <div>
                  <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[#fff5d7] text-[#7a5916]">
                    <Smartphone className="h-5 w-5" />
                  </span>
                  <p className="text-xs font-semibold text-[#8a671d]">
                    {activePortal.badge}
                  </p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                    Verifica tu ingreso
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Enviamos un código de 6 dígitos al celular <b>{maskedPhone}</b>.
                    Vence en 5 minutos.
                  </p>
                </div>

                {error && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                  >
                    {error}
                  </div>
                )}

                <form onSubmit={handleSmsSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="sms-code"
                      className="block text-sm font-semibold text-slate-700"
                    >
                      Código de verificación
                    </label>
                    <input
                      id="sms-code"
                      type="text"
                      required
                      autoFocus
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={smsCode}
                      onChange={(event) =>
                        setSmsCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      placeholder="000000"
                      className="mt-1.5 w-full border border-slate-300 bg-white px-4 py-3 text-center font-mono text-xl font-bold tracking-[0.35em] text-slate-900 outline-none transition focus:border-[#b78b2f] focus:ring-2 focus:ring-[#f2e3b7]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting || smsCode.length !== 6}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-[#b48729] bg-[#d8ad43] py-3.5 text-sm font-bold text-[#20180a] shadow-sm transition hover:bg-[#c99b32] focus:outline-none focus:ring-2 focus:ring-[#9f7622] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {isSubmitting ? "Verificando…" : "Verificar e ingresar"}
                  </button>
                </form>

                <button
                  type="button"
                  disabled={isSubmitting || resendSeconds > 0}
                  onClick={() => void handleSmsResend()}
                  className="w-full text-sm font-semibold text-[#765414] hover:text-[#4f370c] disabled:text-slate-400"
                >
                  {resendSeconds > 0
                    ? `Podrás reenviar en ${resendSeconds} s`
                    : "Reenviar código"}
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="relative hidden flex-col justify-between border-l border-[#e1d5c2] bg-[#f8f3ea] p-10 text-slate-800 lg:col-span-5 lg:flex">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#7a5916]">
            <ShieldCheck className="h-4 w-4" />
            Acceso exclusivo del personal
          </div>

          <div>
            <div className="h-1 w-12 rounded-full bg-[#d8ad43]" />
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.14em] text-[#8a671d]">
              {activePortal.eyebrow}
            </p>
            <h2 className="mt-2 text-3xl font-bold leading-tight text-slate-900">
              {activePortal.title}
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Elige el portal correspondiente a tus funciones y utiliza las credenciales entregadas por la empresa.
            </p>
            <ul className="mt-7 space-y-3 border-t border-[#dfd2bd] pt-6 text-sm text-slate-700">
              {activePortal.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#b8892e]" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-[#dfd2bd] pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            ECONNVRAE · Ayacucho — VRAEM
          </div>
        </aside>
      </div>
    </main>
  );
}

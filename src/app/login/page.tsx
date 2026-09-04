"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  PackageSearch,
  ShieldCheck,
  Smartphone,
  User,
} from "lucide-react";
import { useDatabase, type Usuario } from "@/context/DatabaseContext";

type AuthStage = "credentials" | "sms_verify";

export default function LoginPage() {
  const router = useRouter();
  const { loginUser, verifySmsCode, resendSmsCode, logoutUser } = useDatabase();
  const [authStage, setAuthStage] = useState<AuthStage>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [smsCode, setSmsCode] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(
      () => setResendSeconds((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

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
      <div className="login-card relative z-10 grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-premium lg:grid-cols-12">
        <section className="login-form-panel flex min-h-[570px] flex-col justify-center p-6 sm:p-10 lg:col-span-7 lg:p-12">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <Image
              src="/econnvrae-logo.png"
              alt="ECONNVRAE - Autos y camionetas al VRAEM"
              width={2086}
              height={754}
              priority
              className="h-16 w-auto max-w-[70%] object-contain object-left"
            />
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
              Acceso interno
            </span>
          </div>

          <div className="mt-8">
            {authStage === "credentials" ? (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    Ingresar al sistema
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Usa la cuenta entregada por la empresa. Abriremos automáticamente el panel que corresponde a tu cargo.
                  </p>
                </div>

                {error && (
                  <div role="alert" aria-live="polite" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                )}

                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="login-username" className="block text-sm font-semibold text-slate-700">
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
                        placeholder="Escribe tu usuario"
                        className="w-full border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="login-password" className="block text-sm font-semibold text-slate-700">
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
                        className="w-full border border-slate-300 bg-white py-3 pl-10 pr-12 text-sm text-slate-900 outline-none transition focus:border-slate-700 focus:ring-2 focus:ring-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                        aria-pressed={showPassword}
                        className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-3.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? "Comprobando acceso…" : "Ingresar"}
                    {!isSubmitting && <ArrowRight className="h-4 w-4" />}
                  </button>
                </form>

                <div className="border-t border-slate-200 pt-5">
                  <button
                    type="button"
                    onClick={() => router.push("/public")}
                    className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-2">
                      <PackageSearch className="h-4 w-4 text-slate-500" />
                      Rastrear una encomienda
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </button>
                  <p className="mt-3 text-center text-xs text-slate-500">
                    Si olvidaste tu acceso, solicítalo al administrador de tu agencia.
                  </p>
                </div>
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
                  <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                    <Smartphone className="h-5 w-5" />
                  </span>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                    Verifica tu ingreso
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Enviamos un código de 6 dígitos al celular <b>{maskedPhone}</b>. Vence en 5 minutos.
                  </p>
                </div>

                {error && (
                  <div role="alert" aria-live="polite" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSmsSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="sms-code" className="block text-sm font-semibold text-slate-700">
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
                      onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      className="mt-1.5 w-full border border-slate-300 bg-white px-4 py-3 text-center font-mono text-xl font-bold tracking-[0.35em] text-slate-900 outline-none transition focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting || smsCode.length !== 6}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-3.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {isSubmitting ? "Verificando…" : "Verificar e ingresar"}
                  </button>
                </form>

                <button
                  type="button"
                  disabled={isSubmitting || resendSeconds > 0}
                  onClick={() => void handleSmsResend()}
                  className="w-full text-sm font-semibold text-blue-700 hover:text-blue-900 disabled:text-slate-400"
                >
                  {resendSeconds > 0
                    ? `Podrás reenviar en ${resendSeconds} s`
                    : "Reenviar código"}
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="relative hidden flex-col justify-between bg-[#17243d] p-10 lg:col-span-5 lg:flex">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-200">
            <ShieldCheck className="h-4 w-4" />
            Plataforma de uso interno
          </div>

          <div>
            <div className="h-1 w-12 rounded-full bg-amber-400" />
            <h2 className="mt-5 text-3xl font-bold leading-tight text-white">
              Una cuenta, el acceso correcto.
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              No necesitas elegir un módulo antes de ingresar. El sistema reconoce tu rol y muestra únicamente las funciones autorizadas.
            </p>
            <div className="mt-7 space-y-3 text-sm text-slate-200">
              <p className="flex items-start gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" /> Acceso protegido y registrado.</p>
              <p className="flex items-start gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" /> Verificación SMS solo cuando corresponde.</p>
              <p className="flex items-start gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" /> Operadores y conductores llegan directo a su panel.</p>
            </div>
          </div>

          <div className="border-t border-white/10 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            ECONNVRAE · Ayacucho — VRAEM
          </div>
        </aside>
      </div>
    </main>
  );
}

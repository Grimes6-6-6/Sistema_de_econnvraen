"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
  Copy,
  Eye,
  EyeOff,
  QrCode,
  Smartphone,
} from "lucide-react";
import {
  useDatabase,
  type MfaSetupDetails,
  type Usuario,
} from "@/context/DatabaseContext";

type LoginMode = "selector" | "operador" | "conductor";
type AuthStage =
  | "credentials"
  | "sms_verify"
  | "mfa_setup"
  | "mfa_verify"
  | "recovery_codes";

export default function LoginPage() {
  const router = useRouter();
  const {
    loginUser,
    startMfaSetup,
    confirmMfaSetup,
    verifyMfa,
    resendSmsCode,
    logoutUser,
  } = useDatabase();
  const [loginMode, setLoginMode] = useState<LoginMode>("selector");
  const [authStage, setAuthStage] = useState<AuthStage>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState("");
  const [authenticatorAvailable, setAuthenticatorAvailable] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [mfaSetup, setMfaSetup] = useState<MfaSetupDetails | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [authenticatedUser, setAuthenticatedUser] = useState<Usuario | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectRole = (mode: Exclude<LoginMode, "selector">) => {
    setError("");
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setMfaCode("");
    setMaskedPhone("");
    setAuthenticatorAvailable(false);
    setResendSeconds(0);
    setAuthStage("credentials");
    setLoginMode(mode);
  };

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
      const loginResult = await loginUser(username, password);
      if ("user" in loginResult) {
        routeAuthenticatedUser(loginResult.user);
        return;
      }

      setPassword("");
      setMfaCode("");
      if (loginResult.nextStep === "SMS_VERIFY") {
        setMaskedPhone(loginResult.maskedPhone);
        setAuthenticatorAvailable(loginResult.authenticatorAvailable);
        setResendSeconds(loginResult.retryAfterSeconds);
        setAuthStage("sms_verify");
      } else if (loginResult.nextStep === "MFA_SETUP") {
        setMfaSetup(await startMfaSetup());
        setAuthStage("mfa_setup");
      } else {
        setAuthStage("mfa_verify");
      }
      if ("notice" in loginResult && loginResult.notice) {
        setError(loginResult.notice);
      }
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

  const handleMfaSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const code = useRecoveryCode
        ? mfaCode.trim().toUpperCase()
        : mfaCode.replace(/\D/g, "");
      const method =
        authStage === "sms_verify"
          ? "sms"
          : useRecoveryCode
            ? "recovery"
            : "totp";
      const user = await verifyMfa(code, method);
      routeAuthenticatedUser(user);
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
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
      setMfaCode("");
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "No se pudo reenviar el código.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaSetupSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const result = await confirmMfaSetup(mfaCode.replace(/\D/g, ""));
      setAuthenticatedUser(result.user);
      setRecoveryCodes(result.recoveryCodes);
      setAuthStage("recovery_codes");
      setMfaCode("");
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "No se pudo activar la autenticación en dos pasos.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelMfa = async () => {
    await logoutUser();
    setError("");
    setMfaCode("");
    setMfaSetup(null);
    setRecoveryCodes([]);
    setAuthenticatedUser(null);
    setUseRecoveryCode(false);
    setMaskedPhone("");
    setAuthenticatorAvailable(false);
    setResendSeconds(0);
    setAuthStage("credentials");
  };

  return (
    <main className="corporate-login relative flex min-h-screen items-center justify-center p-4 sm:p-6 lg:p-10 overflow-hidden">
      <div className="login-card relative z-10 grid min-h-[580px] w-full max-w-5xl grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-premium lg:grid-cols-12">
        {/* Left Side: Form Container */}
        <div className="login-form-panel flex flex-col justify-center p-6 sm:p-10 lg:col-span-7 lg:p-12">
          {/* Logo / Brand */}
          <div className="flex items-center gap-3">
            <div className="brand-mark flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-700 text-white">
              <Bus className="h-6 w-6" />
            </div>
            <div>
              <span className="flex items-center gap-2 text-xl font-bold tracking-wide text-slate-900">
                ECONNVRAE
                <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  Personal autorizado
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
                    Acceso al sistema
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-slate-400 font-medium">
                    Selecciona el tipo de operación que necesitas realizar.
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
                      <p className="mt-0.5 text-xs font-medium leading-5 text-slate-400">
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
                      <p className="mt-0.5 text-xs font-medium leading-5 text-slate-400">
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
                      <p className="mt-0.5 text-xs font-medium leading-5 text-slate-400">
                        Viajes asignados, firmas de entrega, GPS e incidencias
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-amber-400 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="animate-slide-in-left space-y-5">
                {authStage !== "recovery_codes" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (authStage === "credentials") {
                        setLoginMode("selector");
                      } else {
                        void cancelMfa();
                      }
                    }}
                    className="group inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                    {authStage === "credentials"
                      ? "Volver a seleccionar módulo"
                      : "Volver al inicio de sesión"}
                  </button>
                )}

                <div>
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                    {authStage === "sms_verify"
                      ? "Confirma tu identidad"
                      : authStage === "mfa_setup"
                      ? "Protege tu cuenta"
                      : authStage === "mfa_verify"
                        ? "Verificación en dos pasos"
                        : authStage === "recovery_codes"
                          ? "Guarda tus códigos"
                          : loginMode === "operador"
                            ? "Acceso de Agencia"
                            : "Acceso Conductor"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400 font-medium">
                    {authStage === "sms_verify"
                      ? `Escribe el código enviado a ${maskedPhone}`
                      : authStage === "mfa_setup"
                      ? "Vincula una aplicación autenticadora antes de continuar"
                      : authStage === "mfa_verify"
                        ? "Confirma el código generado en tu dispositivo"
                        : authStage === "recovery_codes"
                          ? "Se muestran una sola vez; consérvalos en un lugar seguro"
                          : "Ingresa tus credenciales autorizadas por la empresa"}
                  </p>
                </div>

                {error && (
                  <div role="alert" className="rounded-xl bg-red-500/10 p-3.5 text-xs font-bold text-red-300 border border-red-500/30 flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{error}</span>
                  </div>
                )}

                {authStage === "credentials" && (
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
                          autoComplete="username"
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
                          type={showPassword ? "text" : "password"}
                          required
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-12 py-3 pl-10 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all font-medium"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((visible) => !visible)}
                          aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                          aria-pressed={showPassword}
                          className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
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
                )}

                {authStage === "sms_verify" && (
                  <form onSubmit={handleMfaSubmit} className="space-y-4">
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-100">
                      <div className="flex items-center gap-2 font-black">
                        <Smartphone className="h-4 w-4" />
                        Código enviado por SMS
                      </div>
                      <p className="mt-1 text-emerald-100/70">
                        Revisa el mensaje enviado a <b>{maskedPhone}</b>. El código vence en 5 minutos.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="sms-code" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                        Código de 6 dígitos
                      </label>
                      <input
                        id="sms-code"
                        type="text"
                        required
                        autoFocus
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        value={mfaCode}
                        onChange={(event) =>
                          setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        placeholder="000000"
                        className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-4 py-3 text-center font-mono text-lg font-black tracking-[0.3em] text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmitting || mfaCode.length !== 6}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {isSubmitting ? "Verificando..." : "Verificar e ingresar"}
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting || resendSeconds > 0}
                      onClick={() => void handleSmsResend()}
                      className="w-full text-xs font-bold text-emerald-300 hover:text-emerald-200 disabled:text-slate-500"
                    >
                      {resendSeconds > 0
                        ? `Reenviar código en ${resendSeconds} s`
                        : "Reenviar código por SMS"}
                    </button>
                    {authenticatorAvailable && (
                      <button
                        type="button"
                        onClick={() => {
                          setMfaCode("");
                          setUseRecoveryCode(false);
                          setAuthStage("mfa_verify");
                        }}
                        className="w-full text-xs font-bold text-slate-400 hover:text-white"
                      >
                        Usar mi aplicación autenticadora
                      </button>
                    )}
                  </form>
                )}

                {authStage === "mfa_verify" && (
                  <form onSubmit={handleMfaSubmit} className="space-y-4">
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-100">
                      <div className="flex items-center gap-2 font-black">
                        <Smartphone className="h-4 w-4" />
                        Segundo factor requerido
                      </div>
                      <p className="mt-1 text-emerald-100/70">
                        Usa tu aplicación autenticadora o uno de tus códigos de recuperación.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="mfa-code" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                        {useRecoveryCode ? "Código de recuperación" : "Código de 6 dígitos"}
                      </label>
                      <input
                        id="mfa-code"
                        type="text"
                        required
                        autoFocus
                        autoComplete="one-time-code"
                        inputMode={useRecoveryCode ? "text" : "numeric"}
                        value={mfaCode}
                        onChange={(event) =>
                          setMfaCode(
                            useRecoveryCode
                              ? event.target.value.toUpperCase().slice(0, 14)
                              : event.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        placeholder={useRecoveryCode ? "XXXX-XXXX-XXXX" : "000000"}
                        className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-4 py-3 text-center font-mono text-lg font-black tracking-[0.3em] text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMfaCode("");
                        setUseRecoveryCode((current) => !current);
                      }}
                      className="w-full text-xs font-bold text-emerald-300 hover:text-emerald-200"
                    >
                      {useRecoveryCode
                        ? "Usar código de la aplicación"
                        : "Usar código de recuperación"}
                    </button>
                    {maskedPhone && (
                      <button
                        type="button"
                        onClick={() => {
                          setMfaCode("");
                          setUseRecoveryCode(false);
                          setAuthStage("sms_verify");
                        }}
                        className="w-full text-xs font-bold text-slate-400 hover:text-white"
                      >
                        Usar el código enviado por SMS
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {isSubmitting ? "Verificando..." : "Verificar e ingresar"}
                    </button>
                  </form>
                )}

                {authStage === "mfa_setup" && mfaSetup && (
                  <form onSubmit={handleMfaSetupSubmit} className="space-y-4">
                    <ol className="space-y-2 text-xs text-slate-300">
                      <li><b className="text-white">1.</b> Abre Google Authenticator o Microsoft Authenticator.</li>
                      <li><b className="text-white">2.</b> Escanea este QR y escribe el código generado.</li>
                    </ol>
                    <div className="mx-auto w-fit rounded-2xl bg-white p-2">
                      <Image
                        src={mfaSetup.qrCodeDataUrl}
                        alt="QR para activar autenticación en dos pasos"
                        width={192}
                        height={192}
                        unoptimized
                        priority
                      />
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3 text-center">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500">Clave manual</span>
                      <code className="mt-1 block break-all text-xs font-bold text-emerald-300">{mfaSetup.manualKey}</code>
                    </div>
                    <input
                      type="text"
                      required
                      autoFocus
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={mfaCode}
                      onChange={(event) =>
                        setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="Código de 6 dígitos"
                      aria-label="Código de 6 dígitos"
                      className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-4 py-3 text-center font-mono text-lg font-black tracking-[0.3em] text-white focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isSubmitting || mfaCode.length !== 6}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                    >
                      <QrCode className="h-4 w-4" />
                      {isSubmitting ? "Activando..." : "Activar seguridad"}
                    </button>
                  </form>
                )}

                {authStage === "recovery_codes" && authenticatedUser && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-bold text-amber-200">
                      Cada código permite ingresar una sola vez si pierdes acceso a tu aplicación autenticadora.
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                      {recoveryCodes.map((code) => (
                        <code key={code} className="text-center text-xs font-bold text-white">
                          {code}
                        </code>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-800 py-3 text-xs font-bold text-white"
                    >
                      <Copy className="h-4 w-4" /> Copiar códigos
                    </button>
                    <button
                      type="button"
                      onClick={() => routeAuthenticatedUser(authenticatedUser)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-xs font-black uppercase tracking-widest text-white"
                    >
                      He guardado los códigos <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: company information */}
        <div className="login-context-panel relative hidden flex-col justify-between border-l border-emerald-950/20 bg-[#173d32] p-10 lg:col-span-5 lg:flex">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-black uppercase tracking-widest">
            <ShieldCheck className="h-4 w-4" />
            <span>Acceso interno autorizado</span>
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
            <h2 className="text-2xl xl:text-3xl font-bold text-white leading-tight">
              Operación diaria en una sola plataforma
            </h2>
            <p className="text-xs xl:text-sm text-slate-300 font-medium leading-relaxed">
              Venta de pasajes, control de encomiendas, programación de viajes y seguimiento de la flota.
            </p>
          </div>

          <div className="pt-6 border-t border-white/5 flex justify-between items-center text-[10px] text-slate-500 font-bold tracking-wider uppercase">
            <span>ECONNVRAE</span>
            <span>Ayacucho — VRAEM</span>
          </div>
        </div>
      </div>
    </main>
  );
}

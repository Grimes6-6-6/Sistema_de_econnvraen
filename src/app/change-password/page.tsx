"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmation }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message || "No se pudo cambiar la contraseña.");
      }
      router.replace("/login");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cambiar la contraseña.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-5 rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-xl sm:p-8"
      >
        <div className="flex items-center gap-3">
          <span className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-black text-white">Protege tu cuenta</h1>
            <p className="text-xs text-slate-400">La clave temporal debe reemplazarse antes de continuar.</p>
          </div>
        </div>

        {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">{error}</p>}

        <label className="block text-xs font-bold text-slate-300">
          Contraseña temporal
          <input
            type="password"
            required
            minLength={8}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-white outline-none focus:border-emerald-500"
          />
        </label>
        <label className="block text-xs font-bold text-slate-300">
          Nueva contraseña
          <input
            type="password"
            required
            minLength={12}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-white outline-none focus:border-emerald-500"
          />
        </label>
        <label className="block text-xs font-bold text-slate-300">
          Confirmar nueva contraseña
          <input
            type="password"
            required
            minLength={12}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-white outline-none focus:border-emerald-500"
          />
        </label>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Usa 12 o más caracteres con mayúscula, minúscula, número y símbolo. Todas las sesiones anteriores se cerrarán.
        </p>
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-60"
        >
          <KeyRound className="h-4 w-4" /> {busy ? "Actualizando…" : "Cambiar contraseña"}
        </button>
      </form>
    </main>
  );
}

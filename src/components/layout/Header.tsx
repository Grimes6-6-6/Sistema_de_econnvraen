"use client";

import { Bell, Search, User } from "lucide-react";
import { useDatabase } from "@/context/DatabaseContext";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Administrador",
  ADMINISTRADOR: "Administrador",
  OPERADOR: "Operador de Agencia",
  CONDUCTOR: "Conductor",
};

export function Header() {
  const { currentUser } = useDatabase();
  const userName = currentUser
    ? `${currentUser.nombres} ${currentUser.apellidos}`.trim() ||
      currentUser.username
    : "Usuario";
  const roleLabel = currentUser
    ? ROLE_LABELS[currentUser.rol] || currentUser.rol
    : "Invitado";

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-white/10 bg-slate-900/70 backdrop-blur-xl px-6 sm:px-8 shadow-sm">
      <div className="flex flex-1 items-center gap-4">
        <div className="relative w-full max-w-md hidden sm:block">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar viajes, encomiendas o clientes..."
            className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-4 py-2 pl-10 text-xs text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="relative p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-xl transition-colors cursor-pointer border border-transparent hover:border-white/10">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
        </button>

        <div className="h-6 w-px bg-white/10 mx-1"></div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden md:block">
            <p className="text-xs font-black text-white">{userName}</p>
            <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
              {roleLabel}
            </p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black text-xs">
            <User className="h-4 w-4" />
          </div>
        </div>
      </div>
    </header>
  );
}

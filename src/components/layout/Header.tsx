"use client";

import { Bell, Search, User } from "lucide-react";
import { useEffect, useState } from "react";

export function Header() {
  const [userName, setUserName] = useState("Usuario");

  useEffect(() => {
    // Intentar sacar el nombre de la cookie (solo con fines visuales rápidos)
    // El rol real se maneja en SSR
    const cookies = document.cookie.split(";");
    for (const c of cookies) {
      if (c.trim().startsWith("econnvrae_session=")) {
        try {
          const val = decodeURIComponent(c.trim().substring("econnvrae_session=".length));
          const parsed = JSON.parse(val);
          if (parsed.username) setUserName(parsed.username);
        } catch(e) {}
      }
    }
  }, []);

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-slate-200 bg-white px-8">
      <div className="flex flex-1 items-center gap-4">
        <div className="relative w-full max-w-md hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar viajes, encomiendas o clientes..."
            className="saas-input w-full pl-10 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="relative p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600 rounded-full transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 border border-white"></span>
        </button>

        <div className="h-6 w-px bg-slate-200 mx-1"></div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden md:block">
            <p className="text-sm font-medium text-slate-900">{userName}</p>
            <p className="text-xs text-slate-500">Administrador</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <User className="h-5 w-5" />
          </div>
        </div>
      </div>
    </header>
  );
}

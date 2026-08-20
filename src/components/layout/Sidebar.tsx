"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Bus, 
  LayoutDashboard, 
  Route, 
  PackageSearch, 
  Users, 
  Settings, 
  LogOut
} from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const menuItems = [
    { name: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
    { name: "Viajes", icon: Route, path: "/dashboard" },
    { name: "Encomiendas", icon: PackageSearch, path: "/dashboard" },
    { name: "Seguimiento", icon: Bus, path: "/public" },
    { name: "Conductores", icon: Users, path: "/conductor" },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-900/80 border-r border-white/10 backdrop-blur-2xl">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-emerald-500 to-green-700 text-white shadow-md border border-emerald-400/20">
          <Bus className="h-5 w-5" />
        </div>
        <span className="text-base font-black text-white tracking-wider">ECONNVRAE</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
        <div className="mb-4 px-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
          Menú Principal
        </div>
        {menuItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link
              key={item.name}
              href={item.path}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
                isActive 
                  ? "bg-linear-to-r from-emerald-600 to-green-600 text-white shadow-md shadow-emerald-950/50" 
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <item.icon className={`h-4 w-4 ${isActive ? "text-white" : "text-emerald-400"}`} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <Link
          href="/api/auth/logout"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-400 hover:bg-rose-500/10 hover:text-rose-300 border border-transparent hover:border-rose-500/20 transition-all"
        >
          <LogOut className="h-4 w-4 text-slate-500 hover:text-rose-400" />
          Cerrar Sesión
        </Link>
      </div>
    </aside>
  );
}

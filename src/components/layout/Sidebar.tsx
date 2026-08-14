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
    { name: "Viajes", icon: Route, path: "/dashboard/viajes" },
    { name: "Encomiendas", icon: PackageSearch, path: "/dashboard/encomiendas" },
    { name: "Usuarios", icon: Users, path: "/dashboard/usuarios" },
    { name: "Configuración", icon: Settings, path: "/dashboard/configuracion" },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white border-r border-slate-200">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-emerald-700 text-white">
          <Bus className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-slate-900 tracking-tight">ECONNVRAE</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
        <div className="mb-4 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Menu Principal
        </div>
        {menuItems.map((item) => {
          const isActive = pathname === item.path || pathname.startsWith(`${item.path}/`);
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive 
                  ? "bg-emerald-50 text-emerald-700" 
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "text-emerald-700" : "text-slate-400"}`} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <Link
          href="/api/auth/logout"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
        >
          <LogOut className="h-5 w-5 text-slate-400" />
          Cerrar Sesión
        </Link>
      </div>
    </aside>
  );
}

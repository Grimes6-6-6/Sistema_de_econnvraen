"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Truck, BadgeCheck, Navigation } from "lucide-react";

export const DemoSwitcher: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();

  const handleSwitch = (path: string) => {
    router.push(path);
  };

  return (
    <div className="no-print bg-slate-950 text-white px-4 py-2.5 flex flex-col sm:flex-row justify-between items-center border-b-2 border-primary-green sticky top-0 z-50 gap-2 shadow-md">
      <div className="flex items-center gap-2">
        <Truck className="h-5 w-5 text-primary-green-light animate-bounce" />
        <span className="font-semibold text-sm tracking-wide">ECONNVRAE Demo Console</span>
      </div>
      
      <div className="flex gap-2 flex-wrap justify-center">
        <button
          onClick={() => handleSwitch("/dashboard")}
          className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-all ${
            pathname.startsWith("/dashboard") || pathname.startsWith("/login")
              ? "bg-primary-green text-white shadow-lg shadow-emerald-800/30"
              : "bg-slate-800 hover:bg-slate-700 text-slate-300"
          }`}
        >
          <BadgeCheck className="h-3.5 w-3.5" />
          Agencia/Operador
        </button>
        
        <button
          onClick={() => handleSwitch("/conductor")}
          className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-all ${
            pathname.startsWith("/conductor")
              ? "bg-primary-green text-white shadow-lg shadow-emerald-800/30"
              : "bg-slate-800 hover:bg-slate-700 text-slate-300"
          }`}
        >
          <Navigation className="h-3.5 w-3.5" />
          Conductor (Móvil)
        </button>
        
        <button
          onClick={() => handleSwitch("/")}
          className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-all ${
            pathname === "/"
              ? "bg-primary-green text-white shadow-lg shadow-emerald-800/30"
              : "bg-slate-800 hover:bg-slate-700 text-slate-300"
          }`}
        >
          <Truck className="h-3.5 w-3.5" />
          Cliente Público (Web)
        </button>
      </div>
    </div>
  );
};

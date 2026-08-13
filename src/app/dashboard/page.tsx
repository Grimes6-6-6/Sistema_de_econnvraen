"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useDatabase, Viaje, Boleto, Encomienda } from "@/context/DatabaseContext";
import { useLocation } from "@/context/LocationContext";
import AgencySwitcher from "@/components/AgencySwitcher";
import { 
  LayoutDashboard, Ticket, Package, Calendar, Home, FileSpreadsheet, 
  User, LogOut, CheckCircle2, TrendingUp, Printer, Plus, Search, CalendarDays,
  Navigation, Satellite
} from "lucide-react";

// Map loaded client-side only (Leaflet needs window)
const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });

interface DniLookupResult {
  nombres: string;
  apellidos: string;
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function lookupDni(dni: string): Promise<DniLookupResult> {
  const response = await fetch("/api/dni", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dni }),
  });
  const data = (await response.json()) as Partial<DniLookupResult> & {
    success?: boolean;
    error?: string;
  };

  if (
    !response.ok ||
    data.success !== true ||
    typeof data.nombres !== "string" ||
    typeof data.apellidos !== "string"
  ) {
    throw new Error(data.error || "No se pudo consultar el DNI.");
  }

  return { nombres: data.nombres, apellidos: data.apellidos };
}

export default function DashboardPage() {
  const router = useRouter();
  const { 
    db, addBoleto, addEncomienda, addViaje, cancelViaje, assignRecojoDriver,
    updateRecojoStatus,
    currentUser, logoutUser
  } = useDatabase();
  const [activeTab, setActiveTab] = useState<"dashboard" | "venta" | "encomiendas" | "viajes" | "recojos" | "reportes" | "flota">("dashboard");
  const { locations } = useLocation();

  const handleLogout = async () => {
    await logoutUser();
    router.replace("/login");
    router.refresh();
  };

  // Helper date
  const getTodayDateString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // ==========================================================================
  // TAB: OVERVIEW (DASHBOARD)
  // ==========================================================================
  const todayStr = getTodayDateString();

  const kpis = useMemo(() => {
    const todayTrips = db.viajes.filter(v => v.fecha === todayStr);
    const todayTripsIds = todayTrips.map(v => v.id);
    const todayBoletos = db.boletos.filter(b => todayTripsIds.includes(b.id_viaje) && b.estado !== "anulado");
    const pendingParcels = db.encomiendas.filter(e => e.estado !== "entregado");
    
    const pasajesRevenue = todayBoletos.reduce((sum, b) => sum + b.precio, 0);
    const todayParcels = db.encomiendas.filter(e => e.fechaRegistro === todayStr);
    const parcelsRevenue = todayParcels.reduce((sum, p) => sum + p.costo, 0);
    
    return {
      viajes: todayTrips.length,
      pasajes: todayBoletos.length,
      encomiendas: pendingParcels.length,
      ingresos: pasajesRevenue + parcelsRevenue
    };
  }, [db, todayStr]);

  // ==========================================================================
  // TAB: BOOKING pasajes (WIZARD)
  // ==========================================================================
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedDate, setSelectedDate] = useState(getTodayDateString());
  const [selectedTrip, setSelectedTrip] = useState<Viaje | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number>(0);
  const [passengerDni, setPassengerDni] = useState("");
  const [passengerNombres, setPassengerNombres] = useState("");
  const [passengerApellidos, setPassengerApellidos] = useState("");
  const [passengerTelefono, setPassengerTelefono] = useState("");
  const [passengerPrecio, setPassengerPrecio] = useState(50);
  const [emittedBoleto, setEmittedBoleto] = useState<Boleto | null>(null);
  const [isQueryingReniec, setIsQueryingReniec] = useState(false);
  const [isQueryingReniecParcel, setIsQueryingReniecParcel] = useState<"rem" | "dest" | null>(null);

  const resetBookingWizard = () => {
    setWizardStep(1);
    setSelectedRouteId("");
    setSelectedDate(getTodayDateString());
    setSelectedTrip(null);
    setSelectedSeat(0);
    setPassengerDni("");
    setPassengerNombres("");
    setPassengerApellidos("");
    setPassengerTelefono("");
    setPassengerPrecio(50);
    setEmittedBoleto(null);
  };

  const getBookedSeats = (tripId: string) => {
    return db.boletos
      .filter(b => b.id_viaje === tripId && b.estado !== "anulado")
      .map(b => b.asiento);
  };

  const searchPassengerDni = async () => {
    if (passengerDni.length !== 8 || !/^\d+$/.test(passengerDni)) {
      alert("Por favor, ingrese un DNI válido de 8 dígitos.");
      return;
    }
    
    setIsQueryingReniec(true);
    
    try {
      const data = await lookupDni(passengerDni);
      setPassengerNombres(data.nombres);
      setPassengerApellidos(data.apellidos);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Error al consultar DNI");
    } finally {
      setIsQueryingReniec(false);
    }
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrip || selectedSeat === 0) {
      alert("Debe elegir asiento.");
      return;
    }

    try {
      const res = await addBoleto({
        id_viaje: selectedTrip.id,
        asiento: selectedSeat,
        pasajeroDni: passengerDni,
        pasajeroNombres: passengerNombres,
        pasajeroApellidos: passengerApellidos,
        pasajeroTelefono: passengerTelefono,
        precio: passengerPrecio,
      });
      if (res) {
        setEmittedBoleto(res);
        setWizardStep(3);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo emitir el boleto.");
    }
  };

  // ==========================================================================
  // TAB: ENCOMIENDAS (PARCELS)
  // ==========================================================================
  const [searchParcelText, setSearchParcelText] = useState("");
  const [filterParcelState, setFilterParcelState] = useState("");
  const [isParcelModalOpen, setIsParcelModalOpen] = useState(false);

  // Form states
  const [parcelRemDni, setParcelRemDni] = useState("");
  const [parcelRemNombre, setParcelRemNombre] = useState("");
  const [parcelRemTelf, setParcelRemTelf] = useState("");
  const [parcelDestDni, setParcelDestDni] = useState("");
  const [parcelDestNombre, setParcelDestNombre] = useState("");
  const [parcelDestTelf, setParcelDestTelf] = useState("");
  const [parcelTripId, setParcelTripId] = useState("");
  const [parcelPeso, setParcelPeso] = useState("");
  const [parcelValor, setParcelValor] = useState("0");
  const [parcelCosto, setParcelCosto] = useState("20");
  const [parcelDesc, setParcelDesc] = useState("");

  const searchParcelClient = async (role: "rem" | "dest") => {
    const dni = role === "rem" ? parcelRemDni : parcelDestDni;
    if (dni.length !== 8 || !/^\d+$/.test(dni)) {
      alert("Por favor, ingrese un DNI válido de 8 dígitos.");
      return;
    }
    
    setIsQueryingReniecParcel(role);
    
    try {
      const data = await lookupDni(dni);
      if (role === "rem") {
        setParcelRemNombre(`${data.nombres} ${data.apellidos}`);
      } else {
        setParcelDestNombre(`${data.nombres} ${data.apellidos}`);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Error al consultar DNI");
    } finally {
      setIsQueryingReniecParcel(null);
    }
  };

  const handleParcelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parcelRemDni || !parcelDestDni || !parcelTripId) {
      alert("Faltan datos obligatorios.");
      return;
    }

    try {
      const res = await addEncomienda({
      id_viaje: parcelTripId,
      remitenteDni: parcelRemDni,
      remitenteNombre: parcelRemNombre,
      remitenteTelefono: parcelRemTelf,
      destinatarioDni: parcelDestDni,
      destinatarioNombre: parcelDestNombre,
      destinatarioTelefono: parcelDestTelf,
      peso: parseFloat(parcelPeso),
      valor: parseFloat(parcelValor),
      costo: parseFloat(parcelCosto),
        descripcion: parcelDesc,
      });

    if (res) {
      alert(`Encomienda registrada con éxito.\nTracking: ${res.codigo_tracking}`);
      setIsParcelModalOpen(false);
      // Reset parcel form
      setParcelRemDni(""); setParcelRemNombre(""); setParcelRemTelf("");
      setParcelDestDni(""); setParcelDestNombre(""); setParcelDestTelf("");
        setParcelTripId(""); setParcelPeso(""); setParcelValor("0"); setParcelCosto("20"); setParcelDesc("");
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo registrar la encomienda.");
    }
  };

  const printParcelLabel = (parcel: Encomienda) => {
    const trip = db.viajes.find(v => v.id === parcel.id_viaje);
    const ruta = trip ? db.rutas.find(r => r.id === trip.id_ruta) : null;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const document = printWindow.document;
    document.title = `Guía de Remisión - ${parcel.codigo_tracking}`;
    document.head.replaceChildren();
    document.body.replaceChildren();

    const style = document.createElement("style");
    style.textContent = `
      body { font-family: "Courier New", Courier, monospace; font-size: 12px; margin: 30px; text-align: center; }
      .label-box { border: 2px dashed #000; padding: 20px; width: 400px; margin: 0 auto; }
      h2 { font-size: 16px; margin-bottom: 5px; }
      .tracking { font-size: 18px; font-weight: bold; background: #f1f5f9; padding: 5px; margin: 10px 0; }
      .details { text-align: left; margin: 15px 0; line-height: 1.5; }
      .qr { border: 2px solid #000; width: 80px; height: 80px; margin: 15px auto; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; }
    `;
    document.head.append(style);

    const labelBox = document.createElement("div");
    labelBox.className = "label-box";

    const heading = document.createElement("h2");
    heading.textContent = "ECONNVRAE TOURS S.A.C.";
    labelBox.append(heading);

    const guideType = document.createElement("div");
    guideType.textContent = "GUÍA DE REMISIÓN REMITENTE";
    labelBox.append(guideType);

    const tracking = document.createElement("div");
    tracking.className = "tracking";
    tracking.textContent = parcel.codigo_tracking;
    labelBox.append(tracking);

    const details = document.createElement("div");
    details.className = "details";
    const detailRows = [
      ["Origen", "Ayacucho"],
      ["Destino", ruta?.destino || "Desconocido"],
      ["Remitente", `${parcel.remitenteNombre} (DNI ${parcel.remitenteDni})`],
      ["Destinatario", `${parcel.destinatarioNombre} (DNI ${parcel.destinatarioDni})`],
      ["Peso", `${parcel.peso} Kg`],
      ["Descripción", parcel.descripcion || "Sin descripción"],
    ];
    for (const [label, value] of detailRows) {
      const row = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      row.append(strong, document.createTextNode(value));
      details.append(row);
    }
    labelBox.append(details);

    const qr = document.createElement("div");
    qr.className = "qr";
    qr.textContent = "QR TRACKING";
    labelBox.append(qr);

    const footer = document.createElement("div");
    footer.textContent = "Consulte el estado en www.econnvrae.com";
    labelBox.append(footer);

    document.body.append(labelBox);
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 100);
  };

  // ==========================================================================
  // TAB: VIAJES (TRIPS)
  // ==========================================================================
  const [isTripModalOpen, setIsTripModalOpen] = useState(false);
  const [tripRutaId, setTripRutaId] = useState("");
  const [tripDateTime, setTripDateTime] = useState("");
  const [tripVehiculoId, setTripVehiculoId] = useState("");
  const [tripConductorId, setTripConductorId] = useState("");
  const [tripPrecio, setTripPrecio] = useState("50");

  const handleTripSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripRutaId || !tripDateTime || !tripVehiculoId || !tripConductorId) {
      alert("Complete todos los campos.");
      return;
    }
    const [fecha, hora] = tripDateTime.split("T");
    try {
      await addViaje({
        id_ruta: tripRutaId,
        id_vehiculo: tripVehiculoId,
        id_conductor: tripConductorId,
        fecha,
        hora,
        precio: parseFloat(tripPrecio),
      });
      setIsTripModalOpen(false);
      setTripRutaId(""); setTripDateTime(""); setTripVehiculoId(""); setTripConductorId(""); setTripPrecio("50");
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo programar el viaje.");
    }
  };

  // ==========================================================================
  // TAB: RECOJOS (PICKUPS)
  // ==========================================================================
  const assignDriverToRecojo = async (recojoId: string) => {
    const drivers = db.conductores.map(c => c.nombres);
    const selected = prompt(`Asignar conductor para recojo:\nEscriba el nombre:\n- ${drivers.join("\n- ")}`, drivers[0]);
    if (selected && drivers.includes(selected)) {
      try {
        await assignRecojoDriver(recojoId, selected);
      } catch (error) {
        alert(error instanceof Error ? error.message : "No se pudo asignar el recojo.");
      }
    } else if (selected) {
      alert("Conductor no válido.");
    }
  };

  const changeRecojoStatus = async (
    recojoId: string,
    newState: "completado" | "cancelado",
  ) => {
    try {
      await updateRecojoStatus(recojoId, newState);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el recojo.",
      );
    }
  };

  // ==========================================================================
  // TAB: REPORTES (FINANCIAL REPORTS)
  // ==========================================================================
  const [repStart, setRepStart] = useState(() => {
    const today = new Date();
    return formatDateInput(new Date(today.getFullYear(), today.getMonth(), 1));
  });
  const [repEnd, setRepEnd] = useState(() => formatDateInput(new Date()));

  const repData = useMemo(() => {
    if (!repStart || !repEnd) {
      return {
        boletos: [] as Boleto[],
        encomiendas: [] as Encomienda[],
        pasajesTotal: 0,
        encomiendasTotal: 0,
        total: 0,
      };
    }
    
    const sDate = new Date(repStart + "T00:00:00");
    const eDate = new Date(repEnd + "T23:59:59");

    const matchedBoletos = db.boletos.filter(b => {
      const trip = db.viajes.find(v => v.id === b.id_viaje);
      if (!trip) return false;
      const tripDate = new Date(trip.fecha + "T12:00:00");
      return tripDate >= sDate && tripDate <= eDate && b.estado !== "anulado";
    });

    const matchedParcels = db.encomiendas.filter(e => {
      const parcelDate = new Date(e.fechaRegistro + "T12:00:00");
      return parcelDate >= sDate && parcelDate <= eDate;
    });

    const pTotal = matchedBoletos.reduce((sum, b) => sum + b.precio, 0);
    const eTotal = matchedParcels.reduce((sum, e) => sum + e.costo, 0);

    return {
      boletos: matchedBoletos,
      encomiendas: matchedParcels,
      pasajesTotal: pTotal,
      encomiendasTotal: eTotal,
      total: pTotal + eTotal
    };
  }, [db, repStart, repEnd]);

  return (
    <div className="grow flex min-h-screen flex-col bg-linear-to-tr from-slate-50 via-slate-100 to-slate-200/50 text-slate-900 lg:flex-row">
      
      {/* SIDEBAR NAVIGATION */}
      <aside className="no-print flex w-full shrink-0 flex-col border-b border-slate-900 bg-slate-950 text-slate-300 shadow-premium lg:w-64 lg:border-b-0 lg:border-r">
        <div className="hidden items-center gap-3 border-b border-slate-900 p-5 lg:flex">
          <Calendar className="h-6 w-6 text-emerald-500" />
          <div>
            <h3 className="font-black text-sm text-white tracking-wider uppercase">ECONNVRAE</h3>
            <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wider">Agencia Principal</span>
          </div>
        </div>

        <nav className="flex grow gap-2 overflow-x-auto p-3 lg:block lg:space-y-1 lg:p-4">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`w-full text-left px-4 py-2.5 rounded-xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "dashboard" ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-premium shadow-emerald-800/10" : "hover:bg-slate-900 hover:text-white"
            }`}
          >
            <LayoutDashboard className="h-4.5 w-4.5 text-emerald-400" /> Dashboard
          </button>
          
          <button
            onClick={() => setActiveTab("venta")}
            className={`w-full text-left px-4 py-2.5 rounded-xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "venta" ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-premium shadow-emerald-800/10" : "hover:bg-slate-900 hover:text-white"
            }`}
          >
            <Ticket className="h-4.5 w-4.5 text-emerald-400" /> Vender Pasaje
          </button>

          <button
            onClick={() => setActiveTab("encomiendas")}
            className={`w-full text-left px-4 py-2.5 rounded-xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "encomiendas" ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-premium shadow-emerald-800/10" : "hover:bg-slate-900 hover:text-white"
            }`}
          >
            <Package className="h-4.5 w-4.5 text-emerald-400" /> Encomiendas
          </button>

          <button
            onClick={() => setActiveTab("viajes")}
            className={`w-full text-left px-4 py-2.5 rounded-xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "viajes" ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-premium shadow-emerald-800/10" : "hover:bg-slate-900 hover:text-white"
            }`}
          >
            <Calendar className="h-4.5 w-4.5 text-emerald-400" /> Programar Viajes
          </button>

          <button
            onClick={() => setActiveTab("recojos")}
            className={`w-full text-left px-4 py-2.5 rounded-xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "recojos" ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-premium shadow-emerald-800/10" : "hover:bg-slate-900 hover:text-white"
            }`}
          >
            <Home className="h-4.5 w-4.5 text-emerald-400" /> Recojos Domicilio
          </button>

          <button
            onClick={() => setActiveTab("reportes")}
            className={`w-full text-left px-4 py-2.5 rounded-xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "reportes" ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-premium shadow-emerald-800/10" : "hover:bg-slate-900 hover:text-white"
            }`}
          >
            <FileSpreadsheet className="h-4.5 w-4.5 text-emerald-400" /> Reportes e Ingresos
          </button>

          <button
            onClick={() => setActiveTab("flota")}
            className={`w-full text-left px-4 py-2.5 rounded-xl flex items-center gap-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "flota" ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-premium shadow-emerald-800/10" : "hover:bg-slate-900 hover:text-white"
            }`}
          >
            <Navigation className="h-4.5 w-4.5 text-emerald-400" /> Flota en Vivo
            {locations.filter(l => l.isActive).length > 0 && (
              <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            )}
          </button>

          <button
            onClick={handleLogout}
            className="flex min-w-max items-center gap-2 rounded-xl border border-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-300 transition hover:border-red-500 hover:bg-red-500 hover:text-white lg:hidden"
          >
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </nav>

        <div className="hidden border-t border-slate-800 bg-slate-950/40 p-4 lg:block">
          <div className="flex items-center gap-2 mb-3">
            <User className="h-8 w-8 text-slate-500 rounded-full bg-slate-800 p-1" />
            <div>
              <h4 className="text-xs font-bold text-white">
                {currentUser ? `${currentUser.nombres} ${currentUser.apellidos}` : "Operador 1"}
              </h4>
              <span className="text-[10px] text-slate-500 font-bold block">
                {currentUser ? currentUser.rol : "Oficinista"}
              </span>
            </div>
          </div>
          <AgencySwitcher />
          <button
            onClick={handleLogout}
            className="w-full border border-slate-800 hover:bg-red-500 hover:border-red-500 hover:text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <LogOut className="h-3.5 w-3.5" /> Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* WORKSPACE CONTENT AREA */}
      <main className="mx-auto w-full max-w-7xl grow overflow-y-auto p-4 sm:p-6 lg:p-8">
        
        {/* ================================================================== */}
        {/* TAB 1: OVERVIEW DASHBOARD */}
        {/* ================================================================== */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 animate-fade-in no-print">
            <div className="flex justify-between items-center pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-2xl font-black text-slate-800">Dashboard de Operaciones</h2>
                <p className="text-slate-500 text-xs mt-0.5">Métricas operativas del día de hoy en la agencia.</p>
              </div>
              <span className="bg-white border border-slate-200 shadow-sm px-4 py-1.5 rounded-full text-xs font-bold text-slate-700">
                Hoy: {new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </div>

            {/* KPI grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
                <span className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center"><Calendar className="h-6 w-6" /></span>
                <div>
                  <h3 className="text-2xl font-black text-slate-800">{kpis.viajes}</h3>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Viajes de Hoy</span>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
                <span className="h-12 w-12 rounded-xl bg-amber-50 text-amber-800 flex items-center justify-center"><Ticket className="h-6 w-6" /></span>
                <div>
                  <h3 className="text-2xl font-black text-slate-800">{kpis.pasajes}</h3>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Boletos Vendidos</span>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
                <span className="h-12 w-12 rounded-xl bg-blue-50 text-blue-800 flex items-center justify-center"><Package className="h-6 w-6" /></span>
                <div>
                  <h3 className="text-2xl font-black text-slate-800">{kpis.encomiendas}</h3>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Encomiendas Pendientes</span>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
                <span className="h-12 w-12 rounded-xl bg-green-50 text-green-800 flex items-center justify-center"><TrendingUp className="h-6 w-6" /></span>
                <div>
                  <h3 className="text-2xl font-black text-emerald-800">S/ {kpis.ingresos.toFixed(2)}</h3>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Ingresos de Hoy</span>
                </div>
              </div>
            </div>

            {/* Split Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Active Trips today */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
                  <h4 className="font-bold text-sm text-slate-800">Viajes del Día</h4>
                  <button onClick={() => setActiveTab("viajes")} className="text-emerald-800 text-xs font-bold hover:underline cursor-pointer">Ver Itinerario</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="py-2 text-left text-xs font-bold text-slate-400">Hora</th>
                        <th className="py-2 text-left text-xs font-bold text-slate-400">Ruta</th>
                        <th className="py-2 text-left text-xs font-bold text-slate-400">Conductor</th>
                        <th className="py-2 text-center text-xs font-bold text-slate-400">Capacidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {db.viajes.filter(v => v.fecha === todayStr).length === 0 ? (
                        <tr><td colSpan={4} className="text-center py-4 text-xs text-slate-400">No hay viajes programados para hoy.</td></tr>
                      ) : (
                        db.viajes.filter(v => v.fecha === todayStr).map(trip => {
                          const route = db.rutas.find(r => r.id === trip.id_ruta);
                          const cond = db.conductores.find(c => c.id === trip.id_conductor);
                          const booked = getBookedSeats(trip.id).length;
                          return (
                            <tr key={trip.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                              <td className="py-2.5 text-xs font-bold text-slate-700">{trip.hora}</td>
                              <td className="py-2.5 text-xs font-medium text-slate-600">{route?.destino}</td>
                              <td className="py-2.5 text-xs text-slate-500">{cond?.nombres.split(" ")[0]}</td>
                              <td className="py-2.5 text-xs text-center font-bold text-slate-700">
                                <span className={`px-2 py-0.5 rounded ${booked === 4 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{booked} / 4</span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Parcels */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
                  <h4 className="font-bold text-sm text-slate-800">Encomiendas Recientes</h4>
                  <button onClick={() => setActiveTab("encomiendas")} className="text-emerald-800 text-xs font-bold hover:underline cursor-pointer">Ver Todas</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="py-2 text-left text-xs font-bold text-slate-400">Tracking</th>
                        <th className="py-2 text-left text-xs font-bold text-slate-400">Destinatario</th>
                        <th className="py-2 text-center text-xs font-bold text-slate-400">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {db.encomiendas.length === 0 ? (
                        <tr><td colSpan={3} className="text-center py-4 text-xs text-slate-400">No hay encomiendas registradas.</td></tr>
                      ) : (
                        [...db.encomiendas].reverse().slice(0, 5).map(parcel => {
                          const stateColors: Record<string, string> = {
                            registrado: "bg-blue-100 text-blue-700",
                            recojo_domicilio: "bg-purple-100 text-purple-700",
                            en_transito: "bg-amber-100 text-amber-700",
                            en_destino: "bg-blue-100 text-blue-700",
                            entregado: "bg-green-100 text-green-700"
                          };
                          return (
                            <tr key={parcel.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                              <td className="py-2.5 text-xs font-mono font-bold text-emerald-800">{parcel.codigo_tracking}</td>
                              <td className="py-2.5 text-xs font-semibold text-slate-600">{parcel.destinatarioNombre}</td>
                              <td className="py-2.5 text-xs text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${stateColors[parcel.estado] || "bg-slate-100"}`}>
                                  {parcel.estado === "recojo_domicilio" ? "recojo" : parcel.estado}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 2: VENTA DE PASAJES (WIZARD) */}
        {/* ================================================================== */}
        {activeTab === "venta" && (
          <div className="space-y-6 animate-fade-in no-print">
            <div>
              <h2 className="text-2xl font-black text-slate-800">Venta de Pasajes en Tiempo Real</h2>
              <p className="text-slate-500 text-xs mt-0.5">Control de aforo riguroso para vehículos tipo Camioneta/Auto (Máx. 4 pasajeros).</p>
            </div>

            {/* Steps indicator */}
            <div className="flex items-center justify-between max-w-lg mx-auto bg-white border border-slate-200 rounded-full p-2 shadow-sm">
              <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold ${wizardStep === 1 ? "bg-emerald-800 text-white" : "text-slate-500"}`}>
                <span className="h-5 w-5 rounded-full bg-black/10 flex items-center justify-center text-[10px]">1</span>
                Viaje
              </div>
              <div className="h-0.5 w-8 bg-slate-200"></div>
              <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold ${wizardStep === 2 ? "bg-emerald-800 text-white" : "text-slate-500"}`}>
                <span className="h-5 w-5 rounded-full bg-black/10 flex items-center justify-center text-[10px]">2</span>
                Pasajero
              </div>
              <div className="h-0.5 w-8 bg-slate-200"></div>
              <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold ${wizardStep === 3 ? "bg-emerald-800 text-white" : "text-slate-500"}`}>
                <span className="h-5 w-5 rounded-full bg-black/10 flex items-center justify-center text-[10px]">3</span>
                Comprobante
              </div>
            </div>

            {/* WIZARD STEP 1: SELECT TRIP */}
            {wizardStep === 1 && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Ruta</label>
                    <select
                      value={selectedRouteId}
                      onChange={(e) => setSelectedRouteId(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none"
                    >
                      <option value="">Seleccione una ruta...</option>
                      {db.rutas.map(r => (
                        <option key={r.id} value={r.id}>{r.origen} ⇄ {r.destino}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Fecha de Salida</label>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <h4 className="font-bold text-sm text-slate-800">Viajes Encontrados</h4>
                  <div className="grid grid-cols-1 gap-3">
                    {db.viajes.filter(v => v.id_ruta === selectedRouteId && v.fecha === selectedDate).length === 0 ? (
                      <div className="text-center py-6 border-2 border-dashed border-slate-100 rounded-xl text-slate-400 text-xs font-semibold">
                        Seleccione una ruta y fecha válida para visualizar salidas disponibles.
                      </div>
                    ) : (
                      db.viajes
                        .filter(v => v.id_ruta === selectedRouteId && v.fecha === selectedDate)
                        .map(trip => {
                          const veh = db.vehiculos.find(ve => ve.id === trip.id_vehiculo);
                          const cond = db.conductores.find(c => c.id === trip.id_conductor);
                          const bookedCount = getBookedSeats(trip.id).length;
                          const available = 4 - bookedCount;

                          return (
                            <div
                              key={trip.id}
                              onClick={() => {
                                if (available > 0) {
                                  setSelectedTrip(trip);
                                  setPassengerPrecio(trip.precio);
                                  setSelectedSeat(0);
                                  setWizardStep(2);
                                } else {
                                  alert("Este viaje ya no cuenta con asientos disponibles.");
                                }
                              }}
                              className="border border-slate-200 rounded-xl p-4 flex justify-between items-center cursor-pointer hover:border-emerald-700 hover:bg-emerald-50/20 transition-all shadow-sm"
                            >
                              <div className="flex items-center gap-3">
                                <span className="h-10 w-10 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center"><CalendarDays className="h-5 w-5" /></span>
                                <div>
                                  <h5 className="font-bold text-sm text-slate-800">Hora de Salida: {trip.hora}</h5>
                                  <p className="text-xs text-slate-400 font-semibold mt-0.5">
                                    Conductor: {cond?.nombres} | {veh?.tipo} ({veh?.placa})
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <strong className="text-emerald-800 text-lg font-black block">S/ {trip.precio.toFixed(2)}</strong>
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${available > 0 ? "text-green-600" : "text-red-500"}`}>
                                  {available > 0 ? `${available} libres` : "lleno"}
                                </span>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* WIZARD STEP 2: SELECT SEAT & PASSENGER FORM */}
            {wizardStep === 2 && selectedTrip && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Visual Seat Selection (Layout) */}
                <div className="md:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between items-center text-center">
                  <div>
                    <h4 className="font-bold text-sm text-slate-800">Distribución de Asientos</h4>
                    <p className="text-[11px] text-slate-400 font-semibold">Toyota Hilux 4x4 / Auto Corolla (Capacidad: 4)</p>
                  </div>
                  
                  <div className="w-56 border-2 border-slate-400 rounded-4xl p-4 bg-slate-50 space-y-4 my-6 shadow-inner">
                    <div className="bg-slate-200 text-slate-500 text-[10px] font-bold py-1 rounded-t-xl tracking-widest uppercase">PARABRISAS</div>
                    
                    {/* Front row */}
                    <div className="flex justify-between items-center gap-4">
                      <div className="flex-1 aspect-square bg-slate-100 border border-slate-200 text-slate-400 rounded-lg flex flex-col items-center justify-center text-[9px] font-semibold cursor-not-allowed">
                        Volante
                      </div>
                      <button
                        onClick={() => !getBookedSeats(selectedTrip.id).includes(1) && setSelectedSeat(1)}
                        className={`flex-1 aspect-square rounded-lg border flex flex-col items-center justify-center text-[9px] font-bold transition-all cursor-pointer ${
                          getBookedSeats(selectedTrip.id).includes(1)
                            ? "bg-red-100 border-red-200 text-red-700 cursor-not-allowed"
                            : selectedSeat === 1
                            ? "bg-emerald-800 border-emerald-950 text-white shadow-md ring-2 ring-emerald-200"
                            : "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                        }`}
                      >
                        Copiloto
                        <span className="font-bold text-xs mt-0.5">A1</span>
                      </button>
                    </div>

                    <div className="h-0.5 border-b border-dashed border-slate-300"></div>

                    {/* Back Row */}
                    <div className="flex justify-between items-center gap-2">
                      {[2, 3, 4].map(sNum => {
                        const isTaken = getBookedSeats(selectedTrip.id).includes(sNum);
                        const isSelected = selectedSeat === sNum;
                        return (
                          <button
                            key={sNum}
                            type="button"
                            onClick={() => !isTaken && setSelectedSeat(sNum)}
                            className={`flex-1 aspect-square rounded-lg border flex flex-col items-center justify-center text-[9px] font-bold transition-all cursor-pointer ${
                              isTaken
                                ? "bg-red-100 border-red-200 text-red-700 cursor-not-allowed"
                                : isSelected
                                ? "bg-emerald-800 border-emerald-950 text-white shadow-md ring-2 ring-emerald-200"
                                : "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                            }`}
                          >
                            Asiento {sNum}
                            <span className="font-bold text-xs mt-0.5">A{sNum}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-4 text-[10px] font-bold text-slate-500 justify-center">
                    <div className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-green-50 border border-green-200 block" /> Libre</div>
                    <div className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-emerald-800 block" /> Elegido</div>
                    <div className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-red-100 border border-red-200 block" /> Ocupado</div>
                  </div>
                </div>

                {/* Passenger Form */}
                <div className="md:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                  <h4 className="font-bold text-sm text-slate-800 pb-2 border-b border-slate-100">Datos del Pasajero</h4>
                  
                  <form onSubmit={handleBookingSubmit} className="space-y-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Documento DNI *</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          maxLength={8}
                          pattern="\d{8}"
                          required
                          value={passengerDni}
                          onChange={(e) => setPassengerDni(e.target.value)}
                          placeholder="8 dígitos"
                          className="grow border border-slate-200 rounded-lg p-2 text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={searchPassengerDni}
                          disabled={isQueryingReniec}
                          className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold px-4 py-2 rounded-lg transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center min-w-27.5"
                        >
                          {isQueryingReniec ? (
                            <span className="flex items-center gap-1">
                              <span className="h-3 w-3 border-2 border-emerald-800 border-t-transparent rounded-full animate-spin"></span>
                              RENIEC...
                            </span>
                          ) : "Buscar RENIEC"}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Nombres *</label>
                        <input
                          type="text"
                          required
                          value={passengerNombres}
                          onChange={(e) => setPassengerNombres(e.target.value)}
                          placeholder="Nombre completo"
                          className="border border-slate-200 rounded-lg p-2 text-sm focus:outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Apellidos *</label>
                        <input
                          type="text"
                          required
                          value={passengerApellidos}
                          onChange={(e) => setPassengerApellidos(e.target.value)}
                          placeholder="Apellidos completos"
                          className="border border-slate-200 rounded-lg p-2 text-sm focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Teléfono Contacto *</label>
                        <input
                          type="tel"
                          required
                          value={passengerTelefono}
                          onChange={(e) => setPassengerTelefono(e.target.value)}
                          placeholder="Celular de contacto"
                          className="border border-slate-200 rounded-lg p-2 text-sm focus:outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Tarifa Pasaje (S/) *</label>
                        <input
                          type="number"
                          min={10}
                          required
                          value={passengerPrecio}
                          onChange={(e) => setPassengerPrecio(parseFloat(e.target.value))}
                          placeholder="Monto pagado"
                          className="border border-slate-200 rounded-lg p-2 text-sm focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setWizardStep(1)}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors"
                      >
                        Volver
                      </button>
                      <button
                        type="submit"
                        className="bg-emerald-800 hover:bg-emerald-950 text-white text-xs font-bold px-6 py-2.5 rounded-lg shadow-md cursor-pointer transition-colors"
                      >
                        Emitir Boleto
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* WIZARD STEP 3: SUCCESS & TICKET PRINT PREVIEW */}
            {wizardStep === 3 && emittedBoleto && (
              <div className="space-y-6">
                <div className="bg-green-50 border border-green-100 text-green-800 rounded-xl p-5 text-center max-w-md mx-auto space-y-2">
                  <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
                  <h3 className="font-extrabold text-lg">¡Pasaje Emitido Correctamente!</h3>
                  <p className="text-xs text-green-700 font-semibold leading-relaxed">
                    El boleto ha sido enviado a la SUNAT. El asiento {emittedBoleto.asiento} queda bloqueado para el viaje de las {selectedTrip?.hora}.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
                  {/* Print Template Card */}
                  <div className="bg-white border border-slate-300 p-6 rounded-md shadow-md font-mono text-[11px] text-black">
                    <div className="text-center space-y-0.5 mb-4">
                      <h4 className="font-black text-sm uppercase">ECONNVRAE TOURS S.A.C.</h4>
                      <p className="text-[10px]">RUC: 20764839201</p>
                      <p className="text-[9px]">Jr. Salvador Cavero 104, Ayacucho</p>
                      <div className="border-b border-dashed border-black my-2"></div>
                      <h5 className="font-bold text-[10px]">BOLETA DE VIAJE ELECTRÓNICA</h5>
                      <h4 className="font-black text-sm">{emittedBoleto.codigo}</h4>
                    </div>
                    
                    <div className="space-y-1">
                      <p><strong>Fecha Emisión:</strong> {emittedBoleto.fechaEmision}</p>
                      <p><strong>Ruta:</strong> Ayacucho ⇄ {db.rutas.find(r => r.id === selectedTrip?.id_ruta)?.destino}</p>
                      <p><strong>Fecha Viaje:</strong> {selectedTrip?.fecha} | {selectedTrip?.hora}</p>
                      <p><strong>Vehículo:</strong> {db.vehiculos.find(v => v.id === selectedTrip?.id_vehiculo)?.placa}</p>
                      <p><strong>Conductor:</strong> {db.conductores.find(c => c.id === selectedTrip?.id_conductor)?.nombres}</p>
                      <div className="border-b border-dashed border-black my-2"></div>
                      <p><strong>Pasajero:</strong> {emittedBoleto.pasajeroNombres} {emittedBoleto.pasajeroApellidos}</p>
                      <p><strong>DNI:</strong> {emittedBoleto.pasajeroDni}</p>
                      <p><strong>Asiento:</strong> Asiento {emittedBoleto.asiento}</p>
                      <div className="border-b border-dashed border-black my-2"></div>
                      <div className="flex justify-between font-bold text-sm my-2">
                        <span>TOTAL PAGADO</span>
                        <span>S/ {emittedBoleto.precio.toFixed(2)}</span>
                      </div>
                      <div className="border-b border-dashed border-black my-2"></div>
                    </div>
                    
                    <div className="text-center space-y-1.5 mt-4">
                      <div className="h-20 w-20 border border-black flex items-center justify-center mx-auto text-[9px] font-bold">QR SUNAT</div>
                      <p className="text-[8px] text-slate-500">Autorizado por SUNAT. Comprobante electrónico representativo.</p>
                    </div>
                  </div>

                  {/* Actions column */}
                  <div className="flex flex-col justify-center gap-4">
                    <button
                      onClick={() => window.print()}
                      className="bg-emerald-800 hover:bg-emerald-950 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 cursor-pointer shadow-md transition-colors"
                    >
                      <Printer className="h-5 w-5" /> Imprimir Boleto
                    </button>
                    <button
                      onClick={resetBookingWizard}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      Vender Otro Pasaje
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 3: ENCOMIENDAS (PARCELS LIST & MODAL) */}
        {/* ================================================================== */}
        {activeTab === "encomiendas" && (
          <div className="space-y-6 animate-fade-in no-print">
            <div className="flex justify-between items-center pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-2xl font-black text-slate-800">Registro y Control de Encomiendas</h2>
                <p className="text-slate-500 text-xs mt-0.5">Control, emisión de guías de remisión y seguimiento de envíos.</p>
              </div>
              <button
                onClick={() => setIsParcelModalOpen(true)}
                className="bg-primary-green hover:bg-primary-green-dark text-white text-xs font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 shadow-md cursor-pointer transition-colors"
              >
                <Plus className="h-4 w-4" /> Registrar Encomienda
              </button>
            </div>

            {/* Filter bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Buscador</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Tracking, DNI de destinatario, nombres..."
                      value={searchParcelText}
                      onChange={(e) => setSearchParcelText(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Estado de Envío</label>
                  <select
                    value={filterParcelState}
                    onChange={(e) => setFilterParcelState(e.target.value)}
                    className="border border-slate-200 rounded-lg p-2 text-sm focus:outline-none"
                  >
                    <option value="">Todos los estados</option>
                    <option value="registrado">Registrado Oficina</option>
                    <option value="recojo_domicilio">Recojo domicilio</option>
                    <option value="en_transito">En Tránsito</option>
                    <option value="en_destino">En Destino</option>
                    <option value="entregado">Entregado</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Encomiendas Table */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Tracking</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Fecha</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Remitente</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Destinatario</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Detalles</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Viaje Asignado</th>
                      <th className="py-3 px-4 text-center text-xs font-bold text-slate-400 uppercase">Estado</th>
                      <th className="py-3 px-4 text-center text-xs font-bold text-slate-400 uppercase">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {db.encomiendas.filter(parcel => {
                      const matchSearch = parcel.codigo_tracking.toLowerCase().includes(searchParcelText.toLowerCase()) ||
                        parcel.destinatarioDni.includes(searchParcelText) ||
                        parcel.destinatarioNombre.toLowerCase().includes(searchParcelText.toLowerCase());
                      const matchStatus = !filterParcelState || parcel.estado === filterParcelState;
                      return matchSearch && matchStatus;
                    }).length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-xs text-slate-400">No se encontraron encomiendas.</td></tr>
                    ) : (
                      db.encomiendas
                        .filter(parcel => {
                          const matchSearch = parcel.codigo_tracking.toLowerCase().includes(searchParcelText.toLowerCase()) ||
                            parcel.destinatarioDni.includes(searchParcelText) ||
                            parcel.destinatarioNombre.toLowerCase().includes(searchParcelText.toLowerCase());
                          const matchStatus = !filterParcelState || parcel.estado === filterParcelState;
                          return matchSearch && matchStatus;
                        })
                        .map(parcel => {
                          const trip = db.viajes.find(v => v.id === parcel.id_viaje);
                          const route = trip ? db.rutas.find(r => r.id === trip.id_ruta) : null;
                          const stateColors: Record<string, string> = {
                            registrado: "bg-blue-100 text-blue-800 border-blue-200",
                            recojo_domicilio: "bg-purple-100 text-purple-800 border-purple-200",
                            en_transito: "bg-amber-100 text-amber-800 border-amber-200",
                            en_destino: "bg-blue-100 text-blue-800 border-blue-200",
                            entregado: "bg-green-100 text-green-800 border-green-200"
                          };
                          return (
                            <tr key={parcel.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                              <td className="py-3 px-4 text-xs font-mono font-bold text-emerald-800">{parcel.codigo_tracking}</td>
                              <td className="py-3 px-4 text-xs text-slate-500 font-semibold">{parcel.fechaRegistro}</td>
                              <td className="py-3 px-4 text-xs">
                                <div className="font-bold text-slate-700">{parcel.remitenteNombre}</div>
                                <div className="text-[10px] text-slate-400 font-semibold">DNI: {parcel.remitenteDni}</div>
                              </td>
                              <td className="py-3 px-4 text-xs">
                                <div className="font-bold text-slate-700">{parcel.destinatarioNombre}</div>
                                <div className="text-[10px] text-slate-400 font-semibold">Cel: {parcel.destinatarioTelefono}</div>
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-600">
                                <div>{parcel.descripcion}</div>
                                <div className="text-[10px] text-slate-400 font-bold">{parcel.peso} Kg | S/ {parcel.costo}</div>
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-500">
                                <div className="font-bold">{trip ? `${trip.fecha} | ${trip.hora}` : "No asignado"}</div>
                                <div className="text-[10px]">{route?.destino}</div>
                              </td>
                              <td className="py-3 px-4 text-xs text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${stateColors[parcel.estado] || "bg-slate-100"}`}>
                                  {parcel.estado === "recojo_domicilio" ? "recojo" : parcel.estado}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center">
                                <button
                                  onClick={() => printParcelLabel(parcel)}
                                  className="bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 px-2.5 py-1 rounded text-xs font-bold cursor-pointer transition-colors"
                                >
                                  Imprimir
                                </button>
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 4: VIAJES (TRIPS LIST & PROGRAM MODAL) */}
        {/* ================================================================== */}
        {activeTab === "viajes" && (
          <div className="space-y-6 animate-fade-in no-print">
            <div className="flex justify-between items-center pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-2xl font-black text-slate-800">Programación de Viajes</h2>
                <p className="text-slate-500 text-xs mt-0.5">Asignación de vehículos, conductores y horarios de salida.</p>
              </div>
              <button
                onClick={() => setIsTripModalOpen(true)}
                className="bg-primary-green hover:bg-primary-green-dark text-white text-xs font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 shadow-md cursor-pointer transition-colors"
              >
                <Plus className="h-4 w-4" /> Programar Viaje
              </button>
            </div>

            {/* Viajes Table */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Fecha / Hora</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Ruta</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Vehículo</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Conductor</th>
                      <th className="py-3 px-4 text-center text-xs font-bold text-slate-400 uppercase">Asientos</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Tarifa Base</th>
                      <th className="py-3 px-4 text-center text-xs font-bold text-slate-400 uppercase">Estado</th>
                      <th className="py-3 px-4 text-center text-xs font-bold text-slate-400 uppercase">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {db.viajes.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-xs text-slate-400">No hay viajes programados.</td></tr>
                    ) : (
                      db.viajes.map(trip => {
                        const route = db.rutas.find(r => r.id === trip.id_ruta);
                        const veh = db.vehiculos.find(v => v.id === trip.id_vehiculo);
                        const cond = db.conductores.find(c => c.id === trip.id_conductor);
                        const booked = getBookedSeats(trip.id).length;

                        return (
                          <tr key={trip.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                            <td className="py-3 px-4 text-xs font-bold text-slate-800">{trip.fecha} | {trip.hora}</td>
                            <td className="py-3 px-4 text-xs font-semibold text-slate-600">{route?.origen} ⇄ {route?.destino}</td>
                            <td className="py-3 px-4 text-xs text-slate-500 font-semibold">{veh?.tipo} ({veh?.placa})</td>
                            <td className="py-3 px-4 text-xs text-slate-500 font-semibold">{cond?.nombres}</td>
                            <td className="py-3 px-4 text-xs text-center font-bold text-slate-700">
                              <span className={`px-2 py-0.5 rounded ${booked === 4 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{booked} / 4</span>
                            </td>
                            <td className="py-3 px-4 text-xs font-bold text-slate-800">S/ {trip.precio.toFixed(2)}</td>
                            <td className="py-3 px-4 text-center">
                              <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                                trip.estado === "programado" ? "bg-blue-100 text-blue-700 border-blue-200" : 
                                trip.estado === "cancelado" ? "bg-red-100 text-red-700 border-red-200" : "bg-green-100 text-green-700 border-green-200"
                              }`}>
                                {trip.estado}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {trip.estado === "programado" ? (
                                <button
                                  onClick={() => {
                                    void cancelViaje(trip.id).catch((error) => {
                                      alert(error instanceof Error ? error.message : "No se pudo cancelar el viaje.");
                                    });
                                  }}
                                  className="bg-red-50 hover:bg-red-100 border border-red-100 text-red-700 px-2 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors"
                                >
                                  Cancelar
                                </button>
                              ) : "---"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 5: RECOJOS A DOMICILIO */}
        {/* ================================================================== */}
        {activeTab === "recojos" && (
          <div className="space-y-6 animate-fade-in no-print">
            <div>
              <h2 className="text-2xl font-black text-slate-800">Solicitudes de Recojo a Domicilio</h2>
              <p className="text-slate-500 text-xs mt-0.5">Gestión de recojo diferenciado de paquetes en la ciudad de Ayacucho.</p>
            </div>

            {/* Recojos Table */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Fecha Solicitada</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Cliente</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Teléfono</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Dirección de Recojo</th>
                      <th className="py-3 px-4 text-left text-xs font-bold text-slate-400 uppercase">Asignado a</th>
                      <th className="py-3 px-4 text-center text-xs font-bold text-slate-400 uppercase">Estado</th>
                      <th className="py-3 px-4 text-center text-xs font-bold text-slate-400 uppercase">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {db.recojos.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-8 text-xs text-slate-400">No hay solicitudes de recojo registradas.</td></tr>
                    ) : (
                      db.recojos.map(recojo => {
                        return (
                          <tr key={recojo.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                            <td className="py-3 px-4 text-xs font-bold text-slate-800">{recojo.fecha}</td>
                            <td className="py-3 px-4 text-xs font-bold text-slate-700">{recojo.nombre}</td>
                            <td className="py-3 px-4 text-xs text-slate-500 font-semibold">{recojo.telefono}</td>
                            <td className="py-3 px-4 text-xs text-slate-600 font-medium">{recojo.direccion}</td>
                            <td className="py-3 px-4 text-xs text-slate-500 font-semibold">{recojo.asignado || <i>Sin asignar</i>}</td>
                            <td className="py-3 px-4 text-center">
                              <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                                recojo.estado === "pendiente" ? "bg-amber-100 text-amber-700 border-amber-200" :
                                recojo.estado === "completado" ? "bg-green-100 text-green-700 border-green-200" : "bg-blue-100 text-blue-700 border-blue-200"
                              }`}>
                                {recojo.estado}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {recojo.estado === "pendiente" && (
                                <button
                                  onClick={() => void assignDriverToRecojo(recojo.id)}
                                  className="bg-primary-green hover:bg-primary-green-dark text-white text-xs font-bold px-3 py-1 rounded cursor-pointer transition-colors"
                                >
                                  Asignar Conductor
                                </button>
                              )}
                              {(recojo.estado === "pendiente" || recojo.estado === "asignado") && (
                                <div className="flex flex-wrap justify-center gap-2">
                                  <button
                                    onClick={() => void changeRecojoStatus(recojo.id, "completado")}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1 rounded cursor-pointer transition-colors"
                                  >
                                    Completar
                                  </button>
                                  <button
                                    onClick={() => void changeRecojoStatus(recojo.id, "cancelado")}
                                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold px-3 py-1 rounded cursor-pointer transition-colors"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              )}
                              {recojo.estado !== "pendiente" && recojo.estado !== "asignado" && (
                                <span className="text-xs text-slate-400 font-semibold">Cerrado</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 6: REPORTES DE VENTAS E INGRESOS */}
        {/* ================================================================== */}
        {activeTab === "reportes" && (
          <div className="space-y-6 animate-fade-in">
            {/* Header section (hidden during print if we want, but print media handles general no-print) */}
            <div className="flex justify-between items-center pb-4 border-b border-slate-200 no-print">
              <div>
                <h2 className="text-2xl font-black text-slate-800">Reporte Consolidado de Ventas</h2>
                <p className="text-slate-500 text-xs mt-0.5">Control financiero de ingresos brutos mensuales en la agencia.</p>
              </div>
              <button
                onClick={() => window.print()}
                className="bg-slate-800 hover:bg-slate-900 border border-slate-700 text-white text-xs font-bold px-4 py-2.5 rounded-lg flex items-center gap-2 shadow-md cursor-pointer transition-colors"
              >
                <Printer className="h-4 w-4" /> Imprimir Reporte
              </button>
            </div>

            {/* Filter Area (no-print) */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm no-print">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Fecha Inicial</label>
                  <input
                    type="date"
                    value={repStart}
                    onChange={(e) => setRepStart(e.target.value)}
                    className="border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Fecha Final</label>
                  <input
                    type="date"
                    value={repEnd}
                    onChange={(e) => setRepEnd(e.target.value)}
                    className="border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Report Print Template wrapper */}
            <div className="print-area space-y-6">
              
              {/* Visible Header only during print */}
              <div className="hidden print:block text-center space-y-1 pb-4 border-b-2 border-slate-300">
                <h2 className="text-xl font-bold uppercase">ECONNVRAE TOURS S.A.C.</h2>
                <p className="text-xs">Reporte Consolidado de Ventas de Pasajes y Encomiendas</p>
                <p className="text-[10px] text-slate-500">Rango: {repStart} al {repEnd}</p>
              </div>

              {/* Summary KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm text-center">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Ingresos Pasajes</span>
                  <strong className="text-2xl font-black text-slate-800">S/ {repData.pasajesTotal.toFixed(2)}</strong>
                  <span className="text-[10px] text-slate-400 font-bold block mt-1">{repData.boletos.length} pasajes vendidos</span>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm text-center">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Ingresos Encomiendas</span>
                  <strong className="text-2xl font-black text-slate-800">S/ {repData.encomiendasTotal.toFixed(2)}</strong>
                  <span className="text-[10px] text-slate-400 font-bold block mt-1">{repData.encomiendas.length} encomiendas enviadas</span>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 shadow-sm text-center">
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block mb-1">Total Ingresos</span>
                  <strong className="text-3xl font-black text-emerald-800">S/ {repData.total.toFixed(2)}</strong>
                  <span className="text-[10px] text-emerald-700 font-bold block mt-1">Monto total bruto</span>
                </div>
              </div>

              {/* Split tables */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Tickets list */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                  <h4 className="font-extrabold text-sm text-slate-800 mb-4 pb-2 border-b border-slate-100">Pasajes Vendidos</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="py-2 px-2 text-left font-bold text-slate-400">Fecha</th>
                          <th className="py-2 px-2 text-left font-bold text-slate-400">Pasajero</th>
                          <th className="py-2 px-2 text-right font-bold text-slate-400">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repData.boletos.length === 0 ? (
                          <tr><td colSpan={3} className="text-center py-4 text-slate-400">No hay ventas registradas.</td></tr>
                        ) : (
                          repData.boletos.map((b) => (
                            <tr key={b.id} className="border-b border-slate-100 last:border-0">
                              <td className="py-2 px-2 text-slate-500 font-semibold">{b.fechaEmision.split(" ")[0]}</td>
                              <td className="py-2 px-2 text-slate-700 font-bold">{b.pasajeroNombres} {b.pasajeroApellidos.split(" ")[0]}</td>
                              <td className="py-2 px-2 text-right text-slate-800 font-extrabold">S/ {b.precio.toFixed(2)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Parcels list */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                  <h4 className="font-extrabold text-sm text-slate-800 mb-4 pb-2 border-b border-slate-100">Encomiendas Registradas</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="py-2 px-2 text-left font-bold text-slate-400">Fecha</th>
                          <th className="py-2 px-2 text-left font-bold text-slate-400">Tracking</th>
                          <th className="py-2 px-2 text-right font-bold text-slate-400">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repData.encomiendas.length === 0 ? (
                          <tr><td colSpan={3} className="text-center py-4 text-slate-400">No hay envíos registrados.</td></tr>
                        ) : (
                          repData.encomiendas.map((e) => (
                            <tr key={e.id} className="border-b border-slate-100 last:border-0">
                              <td className="py-2 px-2 text-slate-500 font-semibold">{e.fechaRegistro}</td>
                              <td className="py-2 px-2 font-mono font-bold text-emerald-800">{e.codigo_tracking}</td>
                              <td className="py-2 px-2 text-right text-slate-800 font-extrabold">S/ {e.costo.toFixed(2)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}


      {/* TAB 7: FLOTA EN VIVO */}
      {activeTab === "flota" && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex justify-between items-center pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-2xl font-black text-slate-800">Flota en Vivo</h2>
              <p className="text-slate-500 text-xs mt-0.5">Posición GPS en tiempo real de los conductores activos.</p>
            </div>
            <span className={`flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full border ${
              locations.filter(l => l.isActive).length > 0
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-slate-100 border-slate-200 text-slate-500"
            }`}>
              <span className={`h-2 w-2 rounded-full inline-block ${
                locations.filter(l => l.isActive).length > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
              }`}></span>
              {locations.filter(l => l.isActive).length > 0
                ? `${locations.filter(l => l.isActive).length} activo(s)`
                : "Sin vehículos activos"}
            </span>
          </div>
          {locations.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {locations.map(v => (
                <div key={v.conductorId} className={`rounded-2xl border p-4 shadow-sm ${
                  v.isActive ? "bg-white border-emerald-200" : "bg-slate-50 border-slate-200"
                }`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-8 w-8 rounded-xl flex items-center justify-center text-lg ${
                        v.isActive ? "bg-emerald-100" : "bg-slate-100"
                      }`}>🚐</span>
                      <div>
                        <p className="font-black text-slate-800 text-sm">{v.placa}</p>
                        <p className="text-xs text-slate-500">{v.conductorName}</p>
                      </div>
                    </div>
                    <span className={`flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                      v.isActive ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200 text-slate-500"
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        v.isActive ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                      }`}></span>
                      {v.isActive ? "En ruta" : "Inactivo"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mb-1">🗺 {v.routeLabel}</p>
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500">
                    <div>Lat: <span className="font-mono font-bold text-slate-700">{v.lat.toFixed(5)}</span></div>
                    <div>Lng: <span className="font-mono font-bold text-slate-700">{v.lng.toFixed(5)}</span></div>
                    {v.speed !== null && <div className="col-span-2">Vel: <span className="font-bold">{v.speed} km/h</span></div>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2">{new Date(v.timestamp).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
              <Satellite className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="font-bold text-slate-500">Ningún conductor ha activado el GPS aún</p>
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
              <Navigation className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-black text-slate-600 uppercase tracking-widest">Mapa de Flota</span>
            </div>
            <LiveMap vehicles={locations} zoom={12} className="w-full h-125" />
          </div>
        </div>
      )}

      </main>

      {/* ================================================================== */}
      {/* MODAL: REGISTRAR ENCOMIENDA */}
      {/* ================================================================== */}
      {isParcelModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 animate-slide-up flex flex-col">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-2xl">
              <h3 className="font-extrabold text-slate-800 text-base">Registrar Nueva Encomienda</h3>
              <button
                onClick={() => setIsParcelModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleParcelSubmit} className="p-5 space-y-6 grow">
              
              {/* Remitente */}
              <div className="space-y-3">
                <h4 className="font-bold text-sm text-slate-700 border-l-4 border-emerald-800 pl-2">Datos del Remitente</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">DNI Remitente *</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        maxLength={8}
                        pattern="\d{8}"
                        required
                        value={parcelRemDni}
                        onChange={(e) => setParcelRemDni(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => searchParcelClient("rem")}
                        disabled={isQueryingReniecParcel === "rem"}
                        className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50 flex items-center justify-center min-w-17.5"
                      >
                        {isQueryingReniecParcel === "rem" ? "Buscando..." : "Reniec"}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Nombre Completo *</label>
                    <input
                      type="text"
                      required
                      value={parcelRemNombre}
                      onChange={(e) => setParcelRemNombre(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Teléfono Celular *</label>
                    <input
                      type="tel"
                      required
                      value={parcelRemTelf}
                      onChange={(e) => setParcelRemTelf(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Destinatario */}
              <div className="space-y-3">
                <h4 className="font-bold text-sm text-slate-700 border-l-4 border-emerald-800 pl-2">Datos del Destinatario</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">DNI Destinatario *</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        maxLength={8}
                        pattern="\d{8}"
                        required
                        value={parcelDestDni}
                        onChange={(e) => setParcelDestDni(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => searchParcelClient("dest")}
                        disabled={isQueryingReniecParcel === "dest"}
                        className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer disabled:opacity-50 flex items-center justify-center min-w-17.5"
                      >
                        {isQueryingReniecParcel === "dest" ? "Buscando..." : "Reniec"}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Nombre Completo *</label>
                    <input
                      type="text"
                      required
                      value={parcelDestNombre}
                      onChange={(e) => setParcelDestNombre(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Teléfono Celular *</label>
                    <input
                      type="tel"
                      required
                      value={parcelDestTelf}
                      onChange={(e) => setParcelDestTelf(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Parcel Details */}
              <div className="space-y-3">
                <h4 className="font-bold text-sm text-slate-700 border-l-4 border-emerald-800 pl-2">Detalles del Envío</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="flex flex-col gap-1 md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Asignar a Viaje *</label>
                    <select
                      required
                      value={parcelTripId}
                      onChange={(e) => setParcelTripId(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    >
                      <option value="">Seleccione salida...</option>
                      {db.viajes.filter(v => v.estado === "programado").map(v => {
                        const r = db.rutas.find(ru => ru.id === v.id_ruta);
                        return (
                          <option key={v.id} value={v.id}>
                            {v.fecha} {v.hora} ⇄ {r?.destino}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Peso (Kg) *</label>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      required
                      value={parcelPeso}
                      onChange={(e) => setParcelPeso(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Costo de Envío *</label>
                    <input
                      type="number"
                      min={5}
                      required
                      value={parcelCosto}
                      onChange={(e) => setParcelCosto(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Valor Declarado (S/)</label>
                    <input
                      type="number"
                      min={0}
                      value={parcelValor}
                      onChange={(e) => setParcelValor(e.target.value)}
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Descripción del Paquete *</label>
                    <input
                      type="text"
                      required
                      value={parcelDesc}
                      onChange={(e) => setParcelDesc(e.target.value)}
                      placeholder="Ej: Ropa, autopartes, documentos..."
                      className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsParcelModalOpen(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-emerald-800 hover:bg-emerald-950 text-white text-xs font-bold px-5 py-2.5 rounded-lg shadow-md cursor-pointer transition-colors"
                >
                  Generar Tracking y Guía
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: PROGRAMAR VIAJE */}
      {/* ================================================================== */}
      {isTripModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 animate-slide-up flex flex-col">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-2xl">
              <h3 className="font-extrabold text-slate-800 text-base">Programar Nuevo Viaje</h3>
              <button
                onClick={() => setIsTripModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleTripSubmit} className="p-5 space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ruta de Destino *</label>
                <select
                  required
                  value={tripRutaId}
                  onChange={(e) => setTripRutaId(e.target.value)}
                  className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                >
                  <option value="">Seleccione...</option>
                  {db.rutas.map(r => (
                    <option key={r.id} value={r.id}>{r.origen} ⇄ {r.destino}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Fecha y Hora de Salida *</label>
                <input
                  type="datetime-local"
                  required
                  value={tripDateTime}
                  onChange={(e) => setTripDateTime(e.target.value)}
                  className="border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Vehículo Asignado *</label>
                <select
                  required
                  value={tripVehiculoId}
                  onChange={(e) => setTripVehiculoId(e.target.value)}
                  className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                >
                  <option value="">Seleccione...</option>
                  {db.vehiculos.map(v => (
                    <option key={v.id} value={v.id}>{v.placa} - {v.tipo}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Conductor Asignado *</label>
                <select
                  required
                  value={tripConductorId}
                  onChange={(e) => setTripConductorId(e.target.value)}
                  className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                >
                  <option value="">Seleccione...</option>
                  {db.conductores.map(c => (
                    <option key={c.id} value={c.id}>{c.nombres}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Tarifa Base (S/) *</label>
                <input
                  type="number"
                  min={10}
                  required
                  value={tripPrecio}
                  onChange={(e) => setTripPrecio(e.target.value)}
                  className="border border-slate-200 rounded-lg p-2 text-xs focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTripModalOpen(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-lg cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-emerald-800 hover:bg-emerald-950 text-white text-xs font-bold px-5 py-2.5 rounded-lg shadow-md cursor-pointer transition-colors"
                >
                  Crear Viaje
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

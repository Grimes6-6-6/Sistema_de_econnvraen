"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useDatabase, Viaje, Encomienda } from "@/context/DatabaseContext";
import { useLocation } from "@/context/LocationContext";
import {
  ArrowLeft, Camera, User, CheckCircle2, CloudOff, Wifi, LogOut,
  FileText, Upload, Shield, Edit3, Phone, Mail, MapPin, Save, X,
  AlertTriangle, Clock, Package, Users, LayoutGrid, ChevronRight,
  Navigation, Satellite, Zap, WifiOff
} from "lucide-react";

// Dynamically load the map — no SSR (Leaflet needs window)
const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });

// ── Types ────────────────────────────────────────────────────────────────────
type DocumentStatus = "vigente" | "por_vencer" | "vencido" | "sin_cargar";
interface DriverDoc {
  id: string;
  name: string;
  icon: React.ReactNode;
  expiry: string;
  status: DocumentStatus;
  fileDataUrl: string | null;
  fileMediaType?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const statusMeta: Record<DocumentStatus, { label: string; color: string; dot: string }> = {
  vigente:    { label: "Vigente",      color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",  dot: "bg-emerald-500" },
  por_vencer: { label: "Por Vencer",   color: "bg-amber-500/10 border-amber-500/20 text-amber-400",       dot: "bg-amber-500"   },
  vencido:    { label: "Vencido",      color: "bg-red-500/10 border-red-500/20 text-red-400",             dot: "bg-red-500"     },
  sin_cargar: { label: "Sin Cargar",   color: "bg-slate-700/50 border-slate-700 text-slate-400",          dot: "bg-slate-500"   },
};

export default function ConductorPage() {
  const router = useRouter();
  const {
    db,
    isOffline,
    toggleOffline,
    updateParcelStatus,
    updateViajeStatus,
    currentUser,
    logoutUser,
  } = useDatabase();
  const [mainTab, setMainTab] = useState<"trips" | "perfil" | "documentos" | "gps">("trips");
  const { ownPosition, gpsStatus, gpsError, startTracking, stopTracking } = useLocation();
  const [driverScreen, setDriverScreen] = useState<"trips" | "detail" | "delivery">("trips");

  const isPeruCoordinates = ownPosition
    ? ownPosition.latitude >= -18 && ownPosition.latitude <= 0 && ownPosition.longitude >= -81 && ownPosition.longitude <= -68
    : true;
  const [selectedTrip, setSelectedTrip] = useState<Viaje | null>(null);
  const [activeTab, setActiveTab] = useState<"passengers" | "parcels">("passengers");
  const [selectedParcel, setSelectedParcel] = useState<Encomienda | null>(null);

  // Profile Edit state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profilePhone, setProfilePhone] = useState("987-654-321");
  const [profileEmail, setProfileEmail] = useState("conductor@econnvrae.pe");
  const [profileAddress, setProfileAddress] = useState("Jr. Los Andes 245, Ayacucho");
  const [profileLicense, setProfileLicense] = useState("A-IIb · Lima 2022");

  // Documents state
  const [docs, setDocs] = useState<DriverDoc[]>([
    { id: "soat",      name: "SOAT Vehicular",         icon: <Shield className="h-5 w-5" />,    expiry: "2025-12-31", status: "vigente",    fileDataUrl: null },
    { id: "licencia",  name: "Licencia de Conducir",   icon: <FileText className="h-5 w-5" />,  expiry: "2024-08-15", status: "por_vencer", fileDataUrl: null },
    { id: "revision",  name: "Revisión Técnica",        icon: <CheckCircle2 className="h-5 w-5"/>,expiry:"2025-06-01", status: "vigente",    fileDataUrl: null },
    { id: "poliza",    name: "Póliza de Seguro",        icon: <Shield className="h-5 w-5" />,    expiry: "2024-03-20", status: "vencido",    fileDataUrl: null },
    { id: "brevete",   name: "Certificado Médico",      icon: <User className="h-5 w-5" />,      expiry: "",           status: "sin_cargar", fileDataUrl: null },
    { id: "tarjeta",   name: "Tarjeta de Propiedad",   icon: <FileText className="h-5 w-5" />,  expiry: "",           status: "sin_cargar", fileDataUrl: null },
  ]);

  const handleLogout = async () => {
    stopTracking();
    await logoutUser();
    router.replace("/login");
    router.refresh();
  };

  // Canvas signature
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  const getTodayDateString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const todayStr = getTodayDateString();
  const conductorRecord = db.conductores.find(
    c => c.nombres === (currentUser ? `${currentUser.nombres} ${currentUser.apellidos}` : "Alexis Melgar Vila")
  );
  const conductorId = conductorRecord ? conductorRecord.id : "C01";
  const myTrips = db.viajes.filter(v => v.id_conductor === conductorId && v.fecha === todayStr);
  const getBookedSeats = (tripId: string) => db.boletos.filter(b => b.id_viaje === tripId && b.estado !== "anulado");
  const getParcelsForTrip = (tripId: string) => db.encomiendas.filter(e => e.id_viaje === tripId);

  const handleTripClick = (trip: Viaje) => {
    setSelectedTrip(trip);
    setActiveTab("passengers");
    setDriverScreen("detail");
  };

  const handleTripStatus = async (
    nextState: Extract<Viaje["estado"], "en_curso" | "completado">,
  ) => {
    if (!selectedTrip) return;
    try {
      const updated = await updateViajeStatus(selectedTrip.id, nextState);
      if (updated) setSelectedTrip(updated);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el estado del viaje.",
      );
    }
  };

  const handleParcelStateAction = (parcel: Encomienda, nextState: Encomienda["estado"]) => {
    if (nextState === "entregado") {
      setSelectedParcel(parcel);
      setCapturedPhoto(null);
      setHasSignature(false);
      setDriverScreen("delivery");
      setTimeout(() => initCanvas(), 100);
    } else {
      void updateParcelStatus(parcel.id, nextState).catch((error) => {
        alert(error instanceof Error ? error.message : "No se pudo actualizar el estado.");
      });
    }
  };

  // Canvas logic
  const initCanvas = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  };
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath(); ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true); setHasSignature(true);
  };
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top); ctx.stroke();
  };
  const stopDrawing = () => setIsDrawing(false);
  const clearCanvas = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); setHasSignature(false);
  };
  const startDrawingTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect(); const touch = e.touches[0];
    ctx.beginPath(); ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
    setIsDrawing(true); setHasSignature(true);
  };
  const drawTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect(); const touch = e.touches[0];
    ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top); ctx.stroke();
  };
  const simulatePhoto = () => setCapturedPhoto("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='%23059669'><path d='M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z'/></svg>");
  const confirmDelivery = async () => {
    if (!selectedParcel) return;
    if (!hasSignature) { alert("Es obligatorio registrar la firma del destinatario."); return; }
    const canvas = canvasRef.current;
    const sigUri = canvas ? canvas.toDataURL() : null;
    try {
      await updateParcelStatus(selectedParcel.id, "entregado", {
        signature: sigUri,
        photo: capturedPhoto ? "Foto cargada" : "Sin foto",
      });
      setDriverScreen("detail");
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo registrar la entrega.");
    }
  };

  // Document upload handler (simulated)
  const handleDocUpload = (docId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setDocs(prev => prev.map(d => d.id === docId ? {
        ...d,
        fileDataUrl: ev.target?.result as string,
        fileMediaType: file.type,
        status: d.status === "sin_cargar" ? "vigente" : d.status
      } : d));
    };
    reader.readAsDataURL(file);
  };

  const docsVigentes = docs.filter(d => d.status === "vigente").length;
  const docsProblemas = docs.filter(d => d.status === "vencido" || d.status === "sin_cargar").length;

  return (
    <div className="grow flex flex-col min-h-screen bg-transparent text-white">

      {/* ── Navigation Bar ─────────────────────────────────────────────── */}
      <header className="bg-slate-900/40 backdrop-blur-md border-b border-white/10 shadow-2xl sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-linear-to-br from-emerald-500 to-green-700 flex items-center justify-center font-black text-sm text-white shadow-sm border border-emerald-400/20">
              {currentUser ? currentUser.nombres[0] + currentUser.apellidos[0] : "AM"}
            </span>
            <div>
              <h3 className="text-sm font-black tracking-wide">
                {currentUser ? `${currentUser.nombres} ${currentUser.apellidos}` : "Alexis Melgar Vila"}
              </h3>
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">
                Conductor de Ruta · {currentUser?.agenciaNombre || "Sin agencia"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Offline toggle */}
            <div className="hidden sm:flex items-center gap-2 bg-slate-950/60 border border-white/5 px-3 py-1.5 rounded-xl">
              <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Offline</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={isOffline} onChange={toggleOffline} className="sr-only peer" />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500"></div>
              </label>
              {isOffline ? <CloudOff className="h-3.5 w-3.5 text-red-400" /> : <Wifi className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />}
            </div>
            {/* Logout */}
            <button onClick={handleLogout} title="Cerrar Sesión"
              className="p-2 bg-slate-950/40 border border-white/10 hover:border-red-500/50 hover:bg-red-950/40 rounded-xl text-slate-450 hover:text-red-300 transition-all cursor-pointer">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Bottom Tab bar ── */}
        <div className="max-w-5xl mx-auto px-4 flex gap-1 pb-0">
          {([
            { key: "trips",       label: "Mis Viajes",   icon: <LayoutGrid className="h-4 w-4" /> },
            { key: "perfil",      label: "Mi Perfil",    icon: <User className="h-4 w-4" /> },
            { key: "documentos",  label: "Documentos",   icon: <FileText className="h-4 w-4" /> },
            { key: "gps",         label: "Ubicación",    icon: <Navigation className="h-4 w-4" /> },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => { setMainTab(tab.key); setDriverScreen("trips"); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl border-b-2 transition-all text-xs font-bold uppercase tracking-wider ${
                mainTab === tab.key
                  ? "bg-slate-800/50 border-b-emerald-500 text-white"
                  : "border-b-transparent text-slate-400 hover:text-white"
              }`}>
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* ── Main Workspace ─────────────────────────────────────────────── */}
      <main className="grow max-w-5xl mx-auto w-full px-4 py-8">

        {/* ══════════════════ TAB 1: VIAJES ══════════════════ */}
        {mainTab === "trips" && (
          <div className="animate-fade-in">

            {/* Screen: trip list */}
            {driverScreen === "trips" && (
              <div className="space-y-6">
                {/* Stats Row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="glass-container-dark rounded-2xl p-4 space-y-1 border border-white/5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">Viajes hoy</span>
                    <span className="text-3xl font-black text-white">{myTrips.length}</span>
                  </div>
                  <div className="glass-container-dark rounded-2xl p-4 space-y-1 border border-white/5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">Pasajeros</span>
                    <span className="text-3xl font-black text-emerald-400">
                      {myTrips.reduce((sum, t) => sum + getBookedSeats(t.id).length, 0)}
                    </span>
                  </div>
                  <div className="glass-container-dark rounded-2xl p-4 space-y-1 col-span-2 sm:col-span-1 border border-white/5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">Encomiendas</span>
                    <span className="text-3xl font-black text-amber-400">
                      {myTrips.reduce((sum, t) => sum + getParcelsForTrip(t.id).length, 0)}
                    </span>
                  </div>
                </div>

                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Mis Viajes de Hoy</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {myTrips.length === 0 ? (
                    <div className="col-span-2 text-center py-16 text-sm font-semibold text-slate-500 glass-container-dark border border-white/5 rounded-2xl">
                      No tienes viajes asignados para hoy.
                    </div>
                  ) : (
                    myTrips.map(trip => {
                      const route = db.rutas.find(r => r.id === trip.id_ruta);
                      const veh = db.vehiculos.find(v => v.id === trip.id_vehiculo);
                      const booked = getBookedSeats(trip.id).length;
                      const parcels = getParcelsForTrip(trip.id).length;
                      return (
                        <div key={trip.id} onClick={() => handleTripClick(trip)}
                          className="glass-container-dark border border-white/5 rounded-2xl p-5 shadow-premium hover:border-emerald-500/40 hover:bg-white/5 transition-all cursor-pointer group">
                          <div className="flex justify-between items-start mb-3">
                            <div className="font-black text-base text-emerald-400 leading-tight group-hover:text-emerald-300 transition-colors">
                              {route?.origen} → {route?.destino}
                            </div>
                            <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-500 transition-colors mt-1 shrink-0" />
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 font-bold mb-3">
                            <div>Salida: <span className="text-white">{trip.hora}</span></div>
                            <div>Placa: <span className="text-white">{veh?.placa}</span></div>
                          </div>
                          <div className="flex gap-3">
                            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-white/5 px-2.5 py-1 rounded-xl">
                              <Users className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="text-[10px] font-black text-white">{booked}/4</span>
                            </div>
                            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-white/5 px-2.5 py-1 rounded-xl">
                              <Package className="h-3.5 w-3.5 text-amber-400" />
                              <span className="text-[10px] font-black text-white">{parcels}</span>
                            </div>
                            <span className="ml-auto inline-block px-3 py-1 rounded-xl text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                              {trip.estado}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Screen: detail */}
            {driverScreen === "detail" && selectedTrip && (
              <div className="space-y-5 animate-fade-in">
                <div className="flex items-center gap-2">
                  <button onClick={() => setDriverScreen("trips")}
                    className="p-2 hover:bg-slate-900 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Detalle del Viaje</h4>
                </div>
                {/* Tabs */}
                <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
                  {(["passengers", "parcels"] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      className={`flex-1 py-2 font-black rounded-lg cursor-pointer transition-all uppercase tracking-widest text-[10px] ${
                        activeTab === tab
                          ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-md"
                          : "text-slate-400 hover:text-white"
                      }`}>
                      {tab === "passengers" ? "Pasajeros" : "Encomiendas"}
                    </button>
                  ))}
                </div>

                {selectedTrip.estado === "programado" && (
                  <button
                    type="button"
                    onClick={() => void handleTripStatus("en_curso")}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-500"
                  >
                    <Navigation className="h-4 w-4" />
                    Iniciar viaje
                  </button>
                )}
                {selectedTrip.estado === "en_curso" && (
                  <button
                    type="button"
                    onClick={() => void handleTripStatus("completado")}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-500"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Finalizar viaje
                  </button>
                )}

                {/* Passengers */}
                {activeTab === "passengers" && (
                  <div className="space-y-3">
                    <div className="text-[9px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/20 py-1.5 px-3.5 rounded-xl w-fit">
                      Asientos: {getBookedSeats(selectedTrip.id).length} / 4
                    </div>
                    {getBookedSeats(selectedTrip.id).length === 0 ? (
                      <div className="text-center py-10 text-sm text-slate-500 font-semibold bg-slate-900 border border-slate-800 rounded-2xl">
                        No hay pasajeros registrados.
                      </div>
                    ) : (
                      getBookedSeats(selectedTrip.id).sort((a, b) => a.asiento - b.asiento).map(t => (
                        <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex justify-between items-center hover:bg-slate-850/50 transition-all">
                          <div>
                            <h5 className="font-extrabold text-sm text-white">{t.pasajeroNombres} {t.pasajeroApellidos}</h5>
                            <p className="text-xs text-slate-400 font-bold mt-0.5">DNI: {t.pasajeroDni} | Tel: {t.pasajeroTelefono}</p>
                          </div>
                          <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-black text-xs px-3 py-1.5 rounded-xl">A{t.asiento}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Parcels */}
                {activeTab === "parcels" && (
                  <div className="space-y-3">
                    {getParcelsForTrip(selectedTrip.id).length === 0 ? (
                      <div className="text-center py-10 text-sm text-slate-500 font-semibold bg-slate-900 border border-slate-800 rounded-2xl">
                        No hay encomiendas para transportar.
                      </div>
                    ) : (
                      getParcelsForTrip(selectedTrip.id).map(parcel => {
                        const stateOrder: Record<Encomienda["estado"], {
                          label: string;
                          color: string;
                          next: Encomienda["estado"] | null;
                          nextLabel: string;
                        }> = {
                          registrado:      { label: "Registrado",     color: "bg-blue-500/10 border-blue-500/20 text-blue-400",     next: "en_transito",  nextLabel: "Cargar Viaje" },
                          recojo_domicilio:{ label: "Recojo",         color: "bg-purple-500/10 border-purple-500/20 text-purple-400",next: "en_transito",  nextLabel: "Cargar Viaje" },
                          en_transito:     { label: "En Tránsito",    color: "bg-amber-500/10 border-amber-500/20 text-amber-400",   next: "en_destino",   nextLabel: "Llegó Destino" },
                          en_destino:      { label: "En Destino",     color: "bg-blue-500/10 border-blue-500/20 text-blue-400",     next: "entregado",    nextLabel: "Entregar" },
                          entregado:       { label: "Entregado",      color: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400", next: null, nextLabel: "" },
                        };
                        const current = stateOrder[parcel.estado];
                        return (
                          <div key={parcel.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex justify-between items-center gap-4 hover:bg-slate-850/50 transition-all">
                            <div className="min-w-0">
                              <h5 className="font-black text-sm text-emerald-400 uppercase font-mono">{parcel.codigo_tracking}</h5>
                              <p className="text-xs text-slate-400 font-bold mt-0.5 truncate">Dest: {parcel.destinatarioNombre}</p>
                              <span className={`inline-block text-[9px] font-black uppercase px-2.5 py-0.5 rounded-lg border mt-1.5 ${current.color}`}>{current.label}</span>
                            </div>
                            {current.next && (
                              <button onClick={() => handleParcelStateAction(parcel, current.next!)}
                                className="bg-linear-to-r from-emerald-800 to-green-700 hover:from-emerald-900 hover:to-green-800 text-white font-black text-[10px] uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-premium transition-all cursor-pointer shrink-0">
                                {current.nextLabel}
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Screen: delivery */}
            {driverScreen === "delivery" && selectedParcel && (
              <div className="space-y-5 animate-fade-in max-w-2xl mx-auto">
                <div className="flex items-center gap-2">
                  <button onClick={() => setDriverScreen("detail")}
                    className="p-2 hover:bg-slate-900 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Registrar Entrega</h4>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 text-sm">
                  <p className="text-slate-400">Tracking: <span className="font-mono font-black text-emerald-400">{selectedParcel.codigo_tracking}</span></p>
                  <p className="text-slate-400">Destinatario: <span className="font-bold text-white">{selectedParcel.destinatarioNombre}</span></p>
                  <p className="text-slate-400">Detalle: <span className="text-slate-300">{selectedParcel.descripcion}</span></p>
                </div>

                {/* Signature */}
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Firma del Destinatario *</span>
                  <div className="border-2 border-dashed border-slate-700 rounded-2xl overflow-hidden bg-slate-900/60 flex items-center justify-center p-3">
                    <canvas ref={canvasRef} width={600} height={160}
                      onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                      onTouchStart={startDrawingTouch} onTouchMove={drawTouch} onTouchEnd={stopDrawing}
                      className="block touch-none bg-slate-950 rounded-xl border border-slate-800 w-full max-w-lg h-40" />
                  </div>
                  <button type="button" onClick={clearCanvas}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer text-right w-full">
                    ↺ Limpiar firma
                  </button>
                </div>

                {/* Photo */}
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Evidencia Fotográfica</span>
                  {capturedPhoto ? (
                    <div className="border border-slate-800 bg-slate-900 rounded-2xl p-4 flex items-center gap-4">
                      <Image
                        src={capturedPhoto}
                        alt="Evidencia"
                        width={64}
                        height={64}
                        unoptimized
                        className="h-16 w-16 rounded-xl object-cover"
                      />
                      <div>
                        <p className="text-sm font-bold text-white">Foto capturada</p>
                        <button onClick={() => setCapturedPhoto(null)} className="text-xs text-red-400 hover:text-red-300 font-bold mt-1 cursor-pointer">Eliminar</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={simulatePhoto}
                      className="w-full border-2 border-dashed border-slate-700 rounded-2xl p-8 bg-slate-900/60 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-emerald-500 hover:text-emerald-400 transition-all cursor-pointer">
                      <Camera className="h-8 w-8" />
                      <span className="text-sm font-bold">Capturar Foto de Entrega</span>
                    </button>
                  )}
                </div>

                <button onClick={confirmDelivery}
                  className="w-full bg-linear-to-r from-emerald-800 to-green-700 hover:from-emerald-900 hover:to-green-800 text-white font-black py-4 rounded-2xl text-sm uppercase tracking-widest shadow-premium transition-all cursor-pointer">
                  ✓ Confirmar Entrega
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB 2: PERFIL ══════════════════ */}
        {mainTab === "perfil" && (
          <div className="animate-fade-in max-w-2xl mx-auto space-y-6">
            {/* Profile card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col sm:flex-row items-center sm:items-start gap-5 shadow-premium">
              <div className="h-20 w-20 rounded-2xl bg-linear-to-br from-emerald-500 to-green-700 flex items-center justify-center font-black text-3xl text-white shadow-lg border border-emerald-400/20 shrink-0">
                {currentUser ? currentUser.nombres[0] + currentUser.apellidos[0] : "AM"}
              </div>
              <div className="grow text-center sm:text-left">
                <h2 className="text-xl font-black tracking-wide">
                  {currentUser ? `${currentUser.nombres} ${currentUser.apellidos}` : "Alexis Melgar Vila"}
                </h2>
                <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mt-0.5">Conductor de Ruta · ECONNVRAE</p>
                <div className="flex flex-wrap gap-2 mt-3 justify-center sm:justify-start">
                  <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase px-2.5 py-1 rounded-lg">
                    Conductor Activo
                  </span>
                  <span className="bg-slate-800 text-slate-300 text-[9px] font-black uppercase px-2.5 py-1 rounded-lg">
                    DNI: {currentUser?.dni ?? "28283229"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsEditingProfile(!isEditingProfile)}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-xl transition-all cursor-pointer self-start">
                {isEditingProfile ? <X className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
                {isEditingProfile ? "Cancelar" : "Editar"}
              </button>
            </div>

            {/* Info fields */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-premium space-y-5">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-3">Información de Contacto</h3>

              {[
                { icon: <Phone className="h-4 w-4 text-emerald-400" />, label: "Teléfono Celular", value: profilePhone, set: setProfilePhone },
                { icon: <Mail className="h-4 w-4 text-emerald-400" />, label: "Correo Electrónico", value: profileEmail, set: setProfileEmail },
                { icon: <MapPin className="h-4 w-4 text-emerald-400" />, label: "Dirección", value: profileAddress, set: setProfileAddress },
                { icon: <FileText className="h-4 w-4 text-emerald-400" />, label: "Brevete / Categoría", value: profileLicense, set: setProfileLicense },
              ].map(({ icon, label, value, set }) => (
                <div key={label} className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-1">{icon}</div>
                  <div className="grow">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{label}</label>
                    {isEditingProfile ? (
                      <input value={value} onChange={e => set(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-medium focus:outline-none focus:border-emerald-500 transition-colors" />
                    ) : (
                      <p className="text-sm font-semibold text-white">{value}</p>
                    )}
                  </div>
                </div>
              ))}

              {isEditingProfile && (
                <button onClick={() => setIsEditingProfile(false)}
                  className="w-full bg-linear-to-r from-emerald-800 to-green-700 hover:from-emerald-900 hover:to-green-800 text-white font-black py-3 rounded-xl text-sm uppercase tracking-widest shadow-premium transition-all cursor-pointer flex items-center justify-center gap-2 mt-2">
                  <Save className="h-4 w-4" /> Guardar Cambios
                </button>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Viajes Totales", value: db.viajes.filter(v => v.id_conductor === conductorId).length, color: "text-white" },
                { label: "Pasajeros", value: db.viajes.filter(v => v.id_conductor === conductorId).reduce((s, t) => s + getBookedSeats(t.id).length, 0), color: "text-emerald-400" },
                { label: "Encomiendas", value: db.viajes.filter(v => v.id_conductor === conductorId).reduce((s, t) => s + getParcelsForTrip(t.id).length, 0), color: "text-amber-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
                  <span className={`text-3xl font-black ${color}`}>{value}</span>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════ TAB 3: DOCUMENTOS ══════════════════ */}
        {mainTab === "documentos" && (
          <div className="animate-fade-in space-y-6">
            {/* Summary row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Documentos al día</p>
                <p className="text-3xl font-black text-emerald-400 mt-1">{docsVigentes}</p>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
                <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Por vencer</p>
                <p className="text-3xl font-black text-amber-400 mt-1">{docs.filter(d => d.status === "por_vencer").length}</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">Con problemas</p>
                <p className="text-3xl font-black text-red-400 mt-1">{docsProblemas}</p>
              </div>
            </div>

            {docsProblemas > 0 && (
              <div className="bg-red-950/40 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-300">Acción Requerida</p>
                  <p className="text-xs text-red-400/80 mt-0.5">Tienes <strong>{docsProblemas}</strong> documentos vencidos o sin cargar. Por favor regulariza tu situación lo antes posible para continuar operando.</p>
                </div>
              </div>
            )}

            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Gestión de Documentos Obligatorios</h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {docs.map(doc => {
                const meta = statusMeta[doc.status];
                return (
                  <div key={doc.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-premium">
                    {/* Header */}
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                          {doc.icon}
                        </div>
                        <div>
                          <h5 className="text-sm font-bold text-white leading-tight">{doc.name}</h5>
                          {doc.expiry && (
                            <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1 mt-0.5">
                              <Clock className="h-3 w-3" /> Vence: {doc.expiry}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className={`flex items-center gap-1.5 text-[9px] font-black uppercase px-2.5 py-1 rounded-xl border ${meta.color}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}></span>
                        {meta.label}
                      </span>
                    </div>

                    {/* Preview if uploaded */}
                    {doc.fileDataUrl && (
                      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                        {doc.fileMediaType?.startsWith("image/") ? (
                          <Image
                            src={doc.fileDataUrl}
                            alt={`Vista previa de ${doc.name}`}
                            width={480}
                            height={96}
                            unoptimized
                            className="w-full h-24 object-cover"
                          />
                        ) : (
                          <div className="h-24 flex items-center justify-center gap-2 text-xs font-bold text-slate-300">
                            <FileText className="h-5 w-5" />
                            Documento PDF cargado
                          </div>
                        )}
                      </div>
                    )}

                    {/* Upload button */}
                    <label className={`w-full flex items-center justify-center gap-2 border-2 border-dashed rounded-xl py-2.5 px-4 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      doc.fileDataUrl
                        ? "border-emerald-500/30 text-emerald-400 hover:border-emerald-400 hover:bg-emerald-500/5"
                        : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                    }`}>
                      <Upload className="h-4 w-4" />
                      {doc.fileDataUrl ? "Reemplazar Archivo" : "Subir Documento"}
                      <input type="file" className="hidden" accept="image/*,application/pdf"
                        onChange={e => handleDocUpload(doc.id, e)} />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* ══════════════════ TAB 4: GPS ══════════════════ */}
        {mainTab === "gps" && (() => {
          const route = conductorRecord
            ? (() => {
                const myTrip = db.viajes.find(v => v.id_conductor === conductorId);
                const r = myTrip ? db.rutas.find(r => r.id === myTrip.id_ruta) : null;
                const veh = myTrip ? db.vehiculos.find(v => v.id === myTrip.id_vehiculo) : null;
                return { label: r ? `${r.origen} → ${r.destino}` : "Sin ruta asignada", placa: veh?.placa ?? "---" };
              })()
            : { label: "Sin ruta asignada", placa: "---" };

          return (
            <div className="animate-fade-in space-y-6 max-w-2xl mx-auto">
              {/* Status Card */}
              <div className={`rounded-3xl border p-5 shadow-premium flex items-center justify-between gap-4 ${
                gpsStatus === "active"    ? "bg-emerald-500/10 border-emerald-500/30" :
                gpsStatus === "error"     ? "bg-red-500/10 border-red-500/30" :
                gpsStatus === "requesting"? "bg-amber-500/10 border-amber-500/30" :
                "bg-slate-900 border-slate-800"
              }`}>
                <div className="flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${
                    gpsStatus === "active"    ? "bg-emerald-500" :
                    gpsStatus === "error"     ? "bg-red-500" :
                    gpsStatus === "requesting"? "bg-amber-500" :
                    "bg-slate-800"
                  }`}>
                    {gpsStatus === "active"    && <Satellite className="h-6 w-6 text-white" />}
                    {gpsStatus === "requesting"&& <Satellite className="h-6 w-6 text-white animate-pulse" />}
                    {gpsStatus === "error"     && <WifiOff className="h-6 w-6 text-white" />}
                    {gpsStatus === "idle"      && <Navigation className="h-6 w-6 text-slate-400" />}
                  </div>
                  <div>
                    <h3 className="font-black text-white text-sm">
                      {gpsStatus === "active" && "GPS Activo — Transmitiendo"}
                      {gpsStatus === "requesting" && "Buscando señal GPS..."}
                      {gpsStatus === "error" && "Error de GPS"}
                      {gpsStatus === "idle" && "GPS Inactivo"}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {gpsStatus === "active" && `${route.placa} · ${route.label}`}
                      {gpsStatus === "error" && (gpsError ?? "Error desconocido")}
                      {gpsStatus === "idle" && "Pulsa GPS Real para iniciar el seguimiento"}
                      {gpsStatus === "requesting" && "Concede permisos en el navegador..."}
                    </p>
                  </div>
                </div>

                {/* Toggle buttons */}
                {gpsStatus === "idle" || gpsStatus === "error" ? (
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <button
                      onClick={() => startTracking(conductorId)}
                      className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white font-black text-[10px] uppercase tracking-wider px-3.5 py-2.5 rounded-xl transition-all cursor-pointer">
                      <Zap className="h-3.5 w-3.5 text-yellow-400" /> GPS Real
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={stopTracking}
                    className="shrink-0 flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-600 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all cursor-pointer">
                    <WifiOff className="h-4 w-4" /> Detener
                  </button>
                )}
              </div>

              {/* Coordinate readout */}
              {ownPosition && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: "Latitud",   value: ownPosition.latitude.toFixed(6) },
                        { label: "Longitud",  value: ownPosition.longitude.toFixed(6) },
                        { label: "Precisión", value: `±${Math.round(ownPosition.accuracy)} m` },
                        { label: "Velocidad", value: ownPosition.speed !== null ? `${ownPosition.speed} km/h` : "N/D" },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
                          <p className="text-sm font-black text-emerald-400 mt-1 font-mono">{value}</p>
                        </div>
                      ))}
                    </div>
                    {!isPeruCoordinates && (
                      <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-amber-200 text-sm">
                        <strong>Atención:</strong> Estas coordenadas parecen estar fuera de Perú. Revisa el permiso de ubicación del navegador o prueba con otro dispositivo GPS.
                      </div>
                    )}
                  </>
                )}

              {/* Live map */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-premium">
                <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-black text-slate-300 uppercase tracking-widest">Mapa en Vivo</span>
                  {gpsStatus === "active" && (
                    <span className="ml-auto flex items-center gap-1.5 text-[9px] font-black text-emerald-400 uppercase">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
                      Transmitiendo
                    </span>
                  )}
                </div>
                <LiveMap
                  ownPosition={ownPosition ? {
                    lat: ownPosition.latitude,
                    lng: ownPosition.longitude,
                    accuracy: ownPosition.accuracy
                  } : null}
                  zoom={14}
                  className="w-full h-96"
                />
              </div>

              {/* Info note */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-400">
                  La ubicación se actualiza automáticamente y es visible para el operador y los pasajeros en tiempo real. El mapa usa <strong className="text-slate-300">OpenStreetMap</strong> sin costo adicional.
                </p>
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}

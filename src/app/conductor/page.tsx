"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  useDatabase,
  Viaje,
  Encomienda,
  IncidenciaViaje,
} from "@/context/DatabaseContext";
import { useLocation } from "@/context/LocationContext";
import { DataLoadError, InitialDataLoading } from "@/components/ui/DataState";
import { useFeedback } from "@/components/ui/FeedbackProvider";
import {
  ArrowLeft,
  User,
  CheckCircle2,
  CloudOff,
  Wifi,
  LogOut,
  FileText,
  Edit3,
  Phone,
  Mail,
  MapPin,
  Save,
  X,
  AlertTriangle,
  Package,
  Users,
  LayoutGrid,
  ChevronRight,
  Navigation,
  Satellite,
  Zap,
  WifiOff,
  AlertOctagon,
} from "lucide-react";

// Dynamically load the map — no SSR (Leaflet needs window)
const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function ConductorPage() {
  const router = useRouter();
  const {
    db,
    isInitializing,
    dataError,
    isOffline,
    toggleOffline,
    updateParcelStatus,
    updateViajeStatus,
    updateRecojoStatus,
    reportTripIncident,
    getTripIncidents,
    updateConductorProfile,
    currentUser,
    logoutUser,
    refreshDatabase,
  } = useDatabase();
  const { notify, requestConfirmation } = useFeedback();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<"trips" | "perfil" | "gps">(
    "trips",
  );
  const { ownPosition, gpsStatus, gpsError, startTracking, stopTracking } =
    useLocation();
  const [driverScreen, setDriverScreen] = useState<
    "trips" | "detail" | "delivery"
  >("trips");

  const isPeruCoordinates = ownPosition
    ? ownPosition.latitude >= -18 &&
      ownPosition.latitude <= 0 &&
      ownPosition.longitude >= -81 &&
      ownPosition.longitude <= -68
    : true;
  const [selectedTrip, setSelectedTrip] = useState<Viaje | null>(null);
  const [activeTab, setActiveTab] = useState<
    "passengers" | "parcels" | "incidents"
  >("passengers");
  const [selectedParcel, setSelectedParcel] = useState<Encomienda | null>(null);

  // Incidents state
  const [tripIncidents, setTripIncidents] = useState<IncidenciaViaje[]>([]);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
  const [incidentType, setIncidentType] =
    useState<IncidenciaViaje["tipo"]>("MECANICA");
  const [incidentSeverity, setIncidentSeverity] =
    useState<IncidenciaViaje["nivel_gravedad"]>("LEVE");
  const [incidentDesc, setIncidentDesc] = useState("");
  const [isSubmittingIncident, setIsSubmittingIncident] = useState(false);

  // Profile Edit state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [profilePhone, setProfilePhone] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profileLicense, setProfileLicense] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/conductor/profile", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          contact?: { phone: string; email: string; address: string };
        };
        if (!response.ok || !payload.contact) {
          throw new Error("No se pudo cargar el perfil.");
        }
        if (!cancelled) {
          setProfilePhone(payload.contact.phone);
          setProfileEmail(payload.contact.email);
          setProfileAddress(payload.contact.address);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProfileMsg({
            type: "error",
            text: "No se pudieron cargar los datos de contacto.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const getTodayDateString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const todayStr = getTodayDateString();
  const conductorId = currentUser?.conductorId || "";
  const conductorRecord = db.conductores.find((c) => c.id === conductorId);
  const myTrips = db.viajes.filter(
    (v) => v.id_conductor === conductorId && v.fecha === todayStr,
  );
  const getBookedSeats = (tripId: string) =>
    db.boletos.filter((b) => b.id_viaje === tripId && b.estado !== "anulado");
  const getParcelsForTrip = (tripId: string) =>
    db.encomiendas.filter((e) => e.id_viaje === tripId);

  const loadTripIncidents = useCallback(
    async (tripId: string) => {
      try {
        const incidents = await getTripIncidents(tripId);
        setTripIncidents(incidents);
      } catch {
        setTripIncidents([]);
      }
    },
    [getTripIncidents],
  );

  const handleTripClick = (trip: Viaje) => {
    setSelectedTrip(trip);
    setActiveTab("passengers");
    setDriverScreen("detail");
    void loadTripIncidents(trip.id);
  };

  const handleTripStatus = async (
    nextState: Extract<Viaje["estado"], "en_curso" | "completado">,
  ) => {
    if (!selectedTrip) return;
    if (nextState === "completado") {
      const result = await requestConfirmation({
        title: "Finalizar viaje",
        message:
          "Confirma que la unidad llegó a destino y que la operación del viaje terminó.",
        confirmLabel: "Finalizar viaje",
        cancelLabel: "Volver",
        tone: "primary",
      });
      if (!result.confirmed) return;
    }

    setPendingAction(`trip-${nextState}`);
    try {
      const updated = await updateViajeStatus(selectedTrip.id, nextState);
      if (updated) setSelectedTrip(updated);
      notify({
        type: "success",
        title: nextState === "en_curso" ? "Viaje iniciado" : "Viaje finalizado",
        message:
          nextState === "en_curso"
            ? "La salida quedó registrada en el sistema."
            : "La llegada quedó registrada correctamente.",
      });
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo actualizar el viaje",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handlePickupStatus = async (
    pickupId: string,
    newState: "en_camino" | "completado",
  ) => {
    setPendingAction(`pickup-${pickupId}`);
    try {
      await updateRecojoStatus(pickupId, newState);
      notify({
        type: "success",
        title: newState === "en_camino" ? "Recojo iniciado" : "Recojo completado",
      });
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo actualizar el recojo",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleReportIncidentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrip) return;
    if (!incidentDesc.trim() || incidentDesc.length < 5) {
      notify({
        type: "warning",
        title: "Descripción incompleta",
        message: "Describe la incidencia con al menos 5 caracteres.",
      });
      return;
    }

    setIsSubmittingIncident(true);
    try {
      const created = await reportTripIncident(selectedTrip.id, {
        tipo: incidentType,
        descripcion: incidentDesc.trim(),
        nivel_gravedad: incidentSeverity,
        latitude: ownPosition?.latitude ?? null,
        longitude: ownPosition?.longitude ?? null,
      });
      setTripIncidents((prev) => [created, ...prev]);
      setIsIncidentModalOpen(false);
      setIncidentDesc("");
      notify({
        type: "success",
        title: "Incidencia registrada",
        message: "El reporte ya está disponible para el personal autorizado.",
      });
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo registrar la incidencia",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSubmittingIncident(false);
    }
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setProfileMsg(null);
    try {
      const updated = await updateConductorProfile({
        phone: profilePhone,
        email: profileEmail,
        address: profileAddress,
      });
      if (updated.phone) setProfilePhone(updated.phone);
      if (updated.email) setProfileEmail(updated.email);
      if (updated.address) setProfileAddress(updated.address);
      setIsEditingProfile(false);
      setProfileMsg({
        type: "success",
        text: "Datos de contacto actualizados correctamente.",
      });
    } catch (error) {
      setProfileMsg({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "No se pudo guardar la información.",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleParcelStateAction = (
    parcel: Encomienda,
    nextState: Encomienda["estado"],
  ) => {
    if (nextState === "entregado") {
      setSelectedParcel(parcel);
      setHasSignature(false);
      setDriverScreen("delivery");
      setTimeout(() => initCanvas(), 100);
    } else {
      setPendingAction(`parcel-${parcel.id}`);
      void updateParcelStatus(
        parcel.id,
        nextState,
        null,
        ownPosition
          ? {
              latitude: ownPosition.latitude,
              longitude: ownPosition.longitude,
            }
          : null,
      )
        .then(() => {
          notify({
            type: "success",
            title: "Encomienda actualizada",
            message: `Nuevo estado: ${nextState.replaceAll("_", " ")}.`,
          });
        })
        .catch((error) => {
          notify({
            type: "error",
            title: "No se pudo actualizar la encomienda",
            message: error instanceof Error ? error.message : undefined,
          });
        })
        .finally(() => setPendingAction(null));
    }
  };

  // Canvas logic
  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
  };
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
    setHasSignature(true);
  };
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };
  const stopDrawing = () => setIsDrawing(false);
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };
  const startDrawingTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    ctx.beginPath();
    ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
    setIsDrawing(true);
    setHasSignature(true);
  };
  const drawTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.stroke();
  };
  const confirmDelivery = async () => {
    if (!selectedParcel) return;
    if (!hasSignature) {
      notify({
        type: "warning",
        title: "Falta la firma",
        message: "El destinatario debe firmar antes de confirmar la entrega.",
      });
      return;
    }
    const canvas = canvasRef.current;
    const sigUri = canvas ? canvas.toDataURL() : null;
    setPendingAction("delivery");
    try {
      await updateParcelStatus(selectedParcel.id, "entregado", {
        signature: sigUri,
      }, ownPosition
        ? {
            latitude: ownPosition.latitude,
            longitude: ownPosition.longitude,
          }
        : null);
      setDriverScreen("detail");
      setSelectedParcel(null);
      notify({
        type: "success",
        title: "Entrega confirmada",
        message: "La firma, fecha y ubicación quedaron registradas.",
      });
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo registrar la entrega",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  if (isInitializing) return <InitialDataLoading />;
  if (dataError && currentUser) {
    return (
      <DataLoadError
        message={dataError}
        onRetry={() => void refreshDatabase().catch(() => undefined)}
      />
    );
  }

  return (
    <div className="grow flex flex-col min-h-screen bg-transparent text-white">
      {/* ── Navigation Bar ─────────────────────────────────────────────── */}
      <header className="bg-slate-900/40 backdrop-blur-md border-b border-white/10 shadow-2xl sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="min-w-0 flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-linear-to-br from-emerald-500 to-green-700 flex items-center justify-center font-black text-sm text-white shadow-sm border border-emerald-400/20">
              {currentUser
                ? currentUser.nombres[0] + currentUser.apellidos[0]
                : "--"}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black tracking-wide">
                {currentUser
                  ? `${currentUser.nombres} ${currentUser.apellidos}`
                  : "Conductor"}
              </h3>
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                Conductor de Ruta ·{" "}
                {currentUser?.agenciaNombre || "Sin agencia"}
              </span>
            </div>
          </div>

          <div className="ml-2 flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Offline toggle */}
            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-950/60 px-2 py-1.5 sm:px-3">
              <span className="hidden text-[9px] font-black uppercase tracking-wider text-slate-400 sm:inline">
                Offline
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isOffline}
                  onChange={toggleOffline}
                  aria-label="Activar modo sin conexión"
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500"></div>
              </label>
              {isOffline ? (
                <CloudOff className="h-3.5 w-3.5 text-red-400" />
              ) : (
                <Wifi className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
              )}
            </div>
            {/* Logout */}
            <button
              type="button"
              onClick={handleLogout}
              title="Cerrar Sesión"
              aria-label="Cerrar sesión"
              className="p-2 bg-slate-950/40 border border-white/10 hover:border-red-500/50 hover:bg-red-950/40 rounded-xl text-slate-400 hover:text-red-300 transition-all cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Bottom Tab bar ── */}
        <div className="max-w-5xl mx-auto px-4 flex gap-1 pb-0">
          {(
            [
              {
                key: "trips",
                label: "Mis Viajes",
                icon: <LayoutGrid className="h-4 w-4" />,
              },
              {
                key: "perfil",
                label: "Mi Perfil",
                icon: <User className="h-4 w-4" />,
              },
              {
                key: "gps",
                label: "Ubicación",
                icon: <Navigation className="h-4 w-4" />,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-current={mainTab === tab.key ? "page" : undefined}
              onClick={() => {
                setMainTab(tab.key);
                setDriverScreen("trips");
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl border-b-2 transition-all text-xs font-bold uppercase tracking-wider ${
                mainTab === tab.key
                  ? "bg-slate-800/50 border-b-emerald-500 text-white"
                  : "border-b-transparent text-slate-400 hover:text-white"
              }`}
            >
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
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      Viajes hoy
                    </span>
                    <span className="text-3xl font-black text-white">
                      {myTrips.length}
                    </span>
                  </div>
                  <div className="glass-container-dark rounded-2xl p-4 space-y-1 border border-white/5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      Pasajeros
                    </span>
                    <span className="text-3xl font-black text-emerald-400">
                      {myTrips.reduce(
                        (sum, t) => sum + getBookedSeats(t.id).length,
                        0,
                      )}
                    </span>
                  </div>
                  <div className="glass-container-dark rounded-2xl p-4 space-y-1 col-span-2 sm:col-span-1 border border-white/5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      Encomiendas
                    </span>
                    <span className="text-3xl font-black text-amber-400">
                      {myTrips.reduce(
                        (sum, t) => sum + getParcelsForTrip(t.id).length,
                        0,
                      )}
                    </span>
                  </div>
                </div>

                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  Mis Viajes de Hoy
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {myTrips.length === 0 ? (
                    <div className="col-span-2 text-center py-16 text-sm font-semibold text-slate-500 glass-container-dark border border-white/5 rounded-2xl">
                      No tienes viajes asignados para hoy.
                    </div>
                  ) : (
                    myTrips.map((trip) => {
                      const route = db.rutas.find((r) => r.id === trip.id_ruta);
                      const veh = db.vehiculos.find(
                        (v) => v.id === trip.id_vehiculo,
                      );
                      const booked = getBookedSeats(trip.id).length;
                      const parcels = getParcelsForTrip(trip.id).length;
                      return (
                        <div
                          key={trip.id}
                          onClick={() => handleTripClick(trip)}
                          className="glass-container-dark border border-white/5 rounded-2xl p-5 shadow-premium hover:border-emerald-500/40 hover:bg-white/5 transition-all cursor-pointer group"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div className="font-black text-base text-emerald-400 leading-tight group-hover:text-emerald-300 transition-colors">
                              {route?.origen} → {route?.destino}
                            </div>
                            <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-500 transition-colors mt-1 shrink-0" />
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 font-bold mb-3">
                            <div>
                              Salida:{" "}
                              <span className="text-white">{trip.hora}</span>
                            </div>
                            <div>
                              Placa:{" "}
                              <span className="text-white">{veh?.placa}</span>
                            </div>
                          </div>
                          <div className="flex gap-3">
                            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-white/5 px-2.5 py-1 rounded-xl">
                              <Users className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="text-[10px] font-black text-white">
                                {booked}/4
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-white/5 px-2.5 py-1 rounded-xl">
                              <Package className="h-3.5 w-3.5 text-amber-400" />
                              <span className="text-[10px] font-black text-white">
                                {parcels}
                              </span>
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

                <h4 className="pt-3 text-xs font-black uppercase tracking-widest text-slate-400">
                  Recojos asignados
                </h4>
                {db.recojos.length === 0 ? (
                  <div className="rounded-2xl border border-white/5 bg-slate-900 p-6 text-center text-sm text-slate-500">
                    No tienes recojos asignados.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {db.recojos.map((pickup) => (
                      <article
                        key={pickup.id}
                        className="rounded-2xl border border-white/5 bg-slate-900 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-black text-white">{pickup.nombre}</p>
                            <p className="text-xs text-slate-400">{pickup.direccion}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {pickup.telefono} · {pickup.descripcion}
                            </p>
                          </div>
                          <span className="text-[9px] font-black uppercase text-emerald-400">
                            {pickup.estado.replaceAll("_", " ")}
                          </span>
                        </div>
                        {pickup.estado === "asignado" && (
                          <button
                            type="button"
                            disabled={pendingAction === `pickup-${pickup.id}`}
                            onClick={() =>
                              void handlePickupStatus(pickup.id, "en_camino")
                            }
                            className="mt-3 w-full rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-black uppercase"
                          >
                            {pendingAction === `pickup-${pickup.id}`
                              ? "Actualizando…"
                              : "Iniciar recojo"}
                          </button>
                        )}
                        {pickup.estado === "en_camino" && (
                          <button
                            type="button"
                            disabled={pendingAction === `pickup-${pickup.id}`}
                            onClick={() =>
                              void handlePickupStatus(pickup.id, "completado")
                            }
                            className="mt-3 w-full rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-black uppercase"
                          >
                            {pendingAction === `pickup-${pickup.id}`
                              ? "Actualizando…"
                              : "Confirmar recojo"}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Screen: detail */}
            {driverScreen === "detail" && selectedTrip && (
              <div className="space-y-5 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDriverScreen("trips")}
                      className="p-2 hover:bg-slate-900 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                      Detalle del Viaje · {selectedTrip.id}
                    </h4>
                  </div>
                  <button
                    onClick={() => setIsIncidentModalOpen(true)}
                    className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-300 text-[10px] font-black uppercase px-3 py-1.5 rounded-xl cursor-pointer transition-all"
                  >
                    <AlertOctagon className="h-3.5 w-3.5 text-rose-400" />
                    Reportar Incidencia
                  </button>
                </div>

                {/* Sub-Tabs */}
                <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1">
                  {(
                    [
                      { key: "passengers", label: "Pasajeros" },
                      { key: "parcels", label: "Encomiendas" },
                      {
                        key: "incidents",
                        label: `Incidencias (${tripIncidents.length})`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`flex-1 py-2 font-black rounded-lg cursor-pointer transition-all uppercase tracking-widest text-[10px] ${
                        activeTab === tab.key
                          ? "bg-linear-to-r from-emerald-800 to-green-700 text-white shadow-md"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {selectedTrip.estado === "programado" && (
                  <button
                    type="button"
                    disabled={pendingAction === "trip-en_curso"}
                    onClick={() => void handleTripStatus("en_curso")}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-500 cursor-pointer shadow-premium"
                  >
                    <Navigation className="h-4 w-4" />
                    {pendingAction === "trip-en_curso" ? "Iniciando…" : "Iniciar viaje"}
                  </button>
                )}
                {selectedTrip.estado === "en_curso" && (
                  <button
                    type="button"
                    disabled={pendingAction === "trip-completado"}
                    onClick={() => void handleTripStatus("completado")}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-500 cursor-pointer shadow-premium"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {pendingAction === "trip-completado" ? "Finalizando…" : "Finalizar viaje"}
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
                        No hay pasajeros registrados en este viaje.
                      </div>
                    ) : (
                      getBookedSeats(selectedTrip.id)
                        .sort((a, b) => a.asiento - b.asiento)
                        .map((t) => (
                          <div
                            key={t.id}
                            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex justify-between items-center hover:bg-slate-850/50 transition-all"
                          >
                            <div>
                              <h5 className="font-extrabold text-sm text-white">
                                {t.pasajeroNombres} {t.pasajeroApellidos}
                              </h5>
                              <p className="text-xs text-slate-400 font-bold mt-0.5">
                                DNI: {t.pasajeroDni} | Tel: {t.pasajeroTelefono}
                              </p>
                            </div>
                            <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-black text-xs px-3 py-1.5 rounded-xl">
                              A{t.asiento}
                            </span>
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
                        No hay encomiendas para transportar en este viaje.
                      </div>
                    ) : (
                      getParcelsForTrip(selectedTrip.id).map((parcel) => {
                        const stateOrder: Record<
                          Encomienda["estado"],
                          {
                            label: string;
                            color: string;
                            next: Encomienda["estado"] | null;
                            nextLabel: string;
                          }
                        > = {
                          registrado: {
                            label: "Registrado",
                            color:
                              "bg-blue-500/10 border-blue-500/20 text-blue-400",
                            next: "en_transito",
                            nextLabel: "Cargar Viaje",
                          },
                          recojo_domicilio: {
                            label: "Recojo",
                            color:
                              "bg-purple-500/10 border-purple-500/20 text-purple-400",
                            next: "en_transito",
                            nextLabel: "Cargar Viaje",
                          },
                          en_transito: {
                            label: "En Tránsito",
                            color:
                              "bg-amber-500/10 border-amber-500/20 text-amber-400",
                            next: "en_destino",
                            nextLabel: "Llegó Destino",
                          },
                          en_destino: {
                            label: "En Destino",
                            color:
                              "bg-blue-500/10 border-blue-500/20 text-blue-400",
                            next: "entregado",
                            nextLabel: "Entregar",
                          },
                          entregado: {
                            label: "Entregado",
                            color:
                              "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
                            next: null,
                            nextLabel: "",
                          },
                        };
                        const current = stateOrder[parcel.estado];
                        return (
                          <div
                            key={parcel.id}
                            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex justify-between items-center gap-4 hover:bg-slate-850/50 transition-all"
                          >
                            <div className="min-w-0">
                              <h5 className="font-black text-sm text-emerald-400 uppercase font-mono">
                                {parcel.codigo_tracking}
                              </h5>
                              <p className="text-xs text-slate-400 font-bold mt-0.5 truncate">
                                Dest: {parcel.destinatarioNombre}
                              </p>
                              <span
                                className={`inline-block text-[9px] font-black uppercase px-2.5 py-0.5 rounded-lg border mt-1.5 ${current.color}`}
                              >
                                {current.label}
                              </span>
                            </div>
                            {current.next && (
                              <button
                                type="button"
                                disabled={pendingAction === `parcel-${parcel.id}`}
                                onClick={() =>
                                  handleParcelStateAction(parcel, current.next!)
                                }
                                className="bg-linear-to-r from-emerald-800 to-green-700 hover:from-emerald-900 hover:to-green-800 text-white font-black text-[10px] uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-premium transition-all cursor-pointer shrink-0"
                              >
                                {pendingAction === `parcel-${parcel.id}`
                                  ? "Actualizando…"
                                  : current.nextLabel}
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Incidents Tab */}
                {activeTab === "incidents" && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-slate-400 font-bold">
                        Historial de incidencias registradas en este viaje
                      </p>
                      <button
                        onClick={() => setIsIncidentModalOpen(true)}
                        className="bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-xl transition cursor-pointer"
                      >
                        + Nueva Incidencia
                      </button>
                    </div>

                    {tripIncidents.length === 0 ? (
                      <div className="text-center py-10 text-sm text-slate-500 font-semibold bg-slate-900 border border-slate-800 rounded-2xl">
                        No hay incidencias reportadas en este viaje.
                      </div>
                    ) : (
                      tripIncidents.map((inc) => (
                        <div
                          key={inc.id}
                          className="bg-slate-900 border border-rose-500/20 rounded-2xl p-4 space-y-2"
                        >
                          <div className="flex justify-between items-start">
                            <span className="font-bold text-sm text-rose-300">
                              ⚠️ {inc.tipo.replace("_", " ")}
                            </span>
                            <span
                              className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                                inc.nivel_gravedad === "GRAVE"
                                  ? "bg-red-500/20 border-red-500 text-red-300"
                                  : inc.nivel_gravedad === "MODERADA"
                                    ? "bg-amber-500/20 border-amber-500 text-amber-300"
                                    : "bg-blue-500/20 border-blue-500 text-blue-300"
                              }`}
                            >
                              {inc.nivel_gravedad}
                            </span>
                          </div>
                          <p className="text-xs text-slate-200">
                            {inc.descripcion}
                          </p>
                          <div className="text-[10px] text-slate-500 flex justify-between pt-1 border-t border-slate-800">
                            <span>Fecha: {inc.created_at}</span>
                            {inc.latitude && inc.longitude && (
                              <span>
                                GPS: {inc.latitude.toFixed(4)},{" "}
                                {inc.longitude.toFixed(4)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Screen: delivery */}
            {driverScreen === "delivery" && selectedParcel && (
              <div className="space-y-5 animate-fade-in max-w-2xl mx-auto">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDriverScreen("detail")}
                    className="p-2 hover:bg-slate-900 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Registrar Entrega
                  </h4>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2 text-sm">
                  <p className="text-slate-400">
                    Tracking:{" "}
                    <span className="font-mono font-black text-emerald-400">
                      {selectedParcel.codigo_tracking}
                    </span>
                  </p>
                  <p className="text-slate-400">
                    Destinatario:{" "}
                    <span className="font-bold text-white">
                      {selectedParcel.destinatarioNombre}
                    </span>
                  </p>
                  <p className="text-slate-400">
                    Detalle:{" "}
                    <span className="text-slate-300">
                      {selectedParcel.descripcion}
                    </span>
                  </p>
                </div>

                {/* Signature */}
                <div className="space-y-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                    Firma del Destinatario *
                  </span>
                  <div className="border-2 border-dashed border-slate-700 rounded-2xl overflow-hidden bg-slate-900/60 flex items-center justify-center p-3">
                    <canvas
                      ref={canvasRef}
                      role="img"
                      aria-label="Área para registrar la firma manuscrita del destinatario"
                      width={600}
                      height={160}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawingTouch}
                      onTouchMove={drawTouch}
                      onTouchEnd={stopDrawing}
                      className="block touch-none bg-slate-950 rounded-xl border border-slate-800 w-full max-w-lg h-40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer text-right w-full"
                  >
                    ↺ Limpiar firma
                  </button>
                </div>

                <button
                  type="button"
                  disabled={pendingAction === "delivery"}
                  onClick={() => void confirmDelivery()}
                  className="w-full bg-linear-to-r from-emerald-800 to-green-700 hover:from-emerald-900 hover:to-green-800 text-white font-black py-4 rounded-2xl text-sm uppercase tracking-widest shadow-premium transition-all cursor-pointer"
                >
                  {pendingAction === "delivery" ? "Registrando entrega…" : "✓ Confirmar Entrega"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB 2: PERFIL ══════════════════ */}
        {mainTab === "perfil" && (
          <div className="animate-fade-in max-w-2xl mx-auto space-y-6">
            {/* Feedback alert */}
            {profileMsg && (
              <div
                className={`p-4 rounded-2xl border text-sm font-semibold flex items-center gap-2 ${
                  profileMsg.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-red-500/10 border-red-500/30 text-red-300"
                }`}
              >
                {profileMsg.type === "success" ? "✓" : "⚠️"} {profileMsg.text}
              </div>
            )}

            {/* Profile card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col sm:flex-row items-center sm:items-start gap-5 shadow-premium">
              <div className="h-20 w-20 rounded-2xl bg-linear-to-br from-emerald-500 to-green-700 flex items-center justify-center font-black text-3xl text-white shadow-lg border border-emerald-400/20 shrink-0">
                {currentUser
                  ? currentUser.nombres[0] + currentUser.apellidos[0]
                  : "--"}
              </div>
              <div className="grow text-center sm:text-left">
                <h2 className="text-xl font-black tracking-wide">
                  {currentUser
                    ? `${currentUser.nombres} ${currentUser.apellidos}`
                    : "Conductor"}
                </h2>
                <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mt-0.5">
                  Conductor de Ruta · ECONNVRAE
                </p>
                <div className="flex flex-wrap gap-2 mt-3 justify-center sm:justify-start">
                  <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase px-2.5 py-1 rounded-lg">
                    Conductor Habilitado
                  </span>
                  <span className="bg-slate-800 text-slate-300 text-[9px] font-black uppercase px-2.5 py-1 rounded-lg">
                    DNI: {currentUser?.dni || "No disponible"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsEditingProfile(!isEditingProfile)}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-xl transition-all cursor-pointer self-start"
              >
                {isEditingProfile ? (
                  <X className="h-4 w-4" />
                ) : (
                  <Edit3 className="h-4 w-4" />
                )}
                {isEditingProfile ? "Cancelar" : "Editar"}
              </button>
            </div>

            {/* Info fields */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-premium space-y-5">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-3">
                Información de Contacto
              </h3>

              {[
                {
                  icon: <Phone className="h-4 w-4 text-emerald-400" />,
                  label: "Teléfono Celular",
                  value: profilePhone,
                  set: setProfilePhone,
                },
                {
                  icon: <Mail className="h-4 w-4 text-emerald-400" />,
                  label: "Correo Electrónico",
                  value: profileEmail,
                  set: setProfileEmail,
                },
                {
                  icon: <MapPin className="h-4 w-4 text-emerald-400" />,
                  label: "Dirección",
                  value: profileAddress,
                  set: setProfileAddress,
                },
                {
                  icon: <FileText className="h-4 w-4 text-emerald-400" />,
                  label: "Licencia / Brevete",
                  value: conductorRecord?.nroLicencia || profileLicense,
                  set: setProfileLicense,
                  readOnly: true,
                },
              ].map(({ icon, label, value, set, readOnly }) => (
                <div key={label} className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-1">
                    {icon}
                  </div>
                  <div className="grow">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                      {label}
                    </span>
                    {isEditingProfile && !readOnly ? (
                      <input
                        aria-label={label}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-medium focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    ) : (
                      <p className="text-sm font-semibold text-white">
                        {value}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {isEditingProfile && (
                <button
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                  className="w-full bg-linear-to-r from-emerald-800 to-green-700 hover:from-emerald-900 hover:to-green-800 text-white font-black py-3 rounded-xl text-sm uppercase tracking-widest shadow-premium transition-all cursor-pointer flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />{" "}
                  {isSavingProfile ? "Guardando..." : "Guardar Cambios"}
                </button>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  label: "Viajes Totales",
                  value: db.viajes.filter(
                    (v) => v.id_conductor === conductorId,
                  ).length,
                  color: "text-white",
                },
                {
                  label: "Pasajeros",
                  value: db.viajes
                    .filter((v) => v.id_conductor === conductorId)
                    .reduce((s, t) => s + getBookedSeats(t.id).length, 0),
                  color: "text-emerald-400",
                },
                {
                  label: "Encomiendas",
                  value: db.viajes
                    .filter((v) => v.id_conductor === conductorId)
                    .reduce((s, t) => s + getParcelsForTrip(t.id).length, 0),
                  color: "text-amber-400",
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center"
                >
                  <span className={`text-3xl font-black ${color}`}>{value}</span>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════ TAB 3: GPS ══════════════════ */}
        {mainTab === "gps" &&
          (() => {
            const route = conductorRecord
              ? (() => {
                  const myTrip = db.viajes.find(
                    (v) => v.id_conductor === conductorId,
                  );
                  const r = myTrip
                    ? db.rutas.find((r) => r.id === myTrip.id_ruta)
                    : null;
                  const veh = myTrip
                    ? db.vehiculos.find((v) => v.id === myTrip.id_vehiculo)
                    : null;
                  return {
                    label: r
                      ? `${r.origen} → ${r.destino}`
                      : "Sin ruta asignada",
                    placa: veh?.placa ?? "---",
                  };
                })()
              : { label: "Sin ruta asignada", placa: "---" };

            return (
              <div className="animate-fade-in space-y-6 max-w-2xl mx-auto">
                {/* Status Card */}
                <div
                  className={`rounded-3xl border p-5 shadow-premium flex items-center justify-between gap-4 ${
                    gpsStatus === "active"
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : gpsStatus === "error"
                        ? "bg-red-500/10 border-red-500/30"
                        : gpsStatus === "requesting"
                          ? "bg-amber-500/10 border-amber-500/30"
                          : "bg-slate-900 border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${
                        gpsStatus === "active"
                          ? "bg-emerald-500"
                          : gpsStatus === "error"
                            ? "bg-red-500"
                            : gpsStatus === "requesting"
                              ? "bg-amber-500"
                              : "bg-slate-800"
                      }`}
                    >
                      {gpsStatus === "active" && (
                        <Satellite className="h-6 w-6 text-white" />
                      )}
                      {gpsStatus === "requesting" && (
                        <Satellite className="h-6 w-6 text-white animate-pulse" />
                      )}
                      {gpsStatus === "error" && (
                        <WifiOff className="h-6 w-6 text-white" />
                      )}
                      {gpsStatus === "idle" && (
                        <Navigation className="h-6 w-6 text-slate-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-black text-white text-sm">
                        {gpsStatus === "active" && "GPS Activo — Transmitiendo"}
                        {gpsStatus === "requesting" && "Buscando señal GPS..."}
                        {gpsStatus === "error" && "Error de GPS"}
                        {gpsStatus === "idle" && "GPS Inactivo"}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {gpsStatus === "active" &&
                          `${route.placa} · ${route.label}`}
                        {gpsStatus === "error" &&
                          (gpsError ?? "Error desconocido")}
                        {gpsStatus === "idle" &&
                          "Pulsa GPS Real para iniciar el seguimiento"}
                        {gpsStatus === "requesting" &&
                          "Concede permisos en el navegador..."}
                      </p>
                    </div>
                  </div>

                  {/* Toggle buttons */}
                  {gpsStatus === "idle" || gpsStatus === "error" ? (
                    <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                      <button
                        onClick={() => startTracking(conductorId)}
                        disabled={!conductorId}
                        className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white font-black text-[10px] uppercase tracking-wider px-3.5 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Zap className="h-3.5 w-3.5 text-yellow-400" /> GPS Real
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={stopTracking}
                      className="shrink-0 flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-600 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all cursor-pointer"
                    >
                      <WifiOff className="h-4 w-4" /> Detener
                    </button>
                  )}
                </div>

                {/* Coordinate readout */}
                {ownPosition && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          label: "Latitud",
                          value: ownPosition.latitude.toFixed(6),
                        },
                        {
                          label: "Longitud",
                          value: ownPosition.longitude.toFixed(6),
                        },
                        {
                          label: "Precisión",
                          value: `±${Math.round(ownPosition.accuracy)} m`,
                        },
                        {
                          label: "Velocidad",
                          value:
                            ownPosition.speed !== null
                              ? `${ownPosition.speed} km/h`
                              : "N/D",
                        },
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center"
                        >
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            {label}
                          </p>
                          <p className="text-sm font-black text-emerald-400 mt-1 font-mono">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                    {!isPeruCoordinates && (
                      <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-amber-200 text-sm">
                        <strong>Atención:</strong> Estas coordenadas parecen
                        estar fuera de Perú. Revisa el permiso de ubicación del
                        navegador o prueba con otro dispositivo GPS.
                      </div>
                    )}
                  </>
                )}

                {/* Live map */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-premium">
                  <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-black text-slate-300 uppercase tracking-widest">
                      Mapa en Vivo
                    </span>
                    {gpsStatus === "active" && (
                      <span className="ml-auto flex items-center gap-1.5 text-[9px] font-black text-emerald-400 uppercase">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
                        Transmitiendo
                      </span>
                    )}
                  </div>
                  <LiveMap
                    ownPosition={
                      ownPosition
                        ? {
                            lat: ownPosition.latitude,
                            lng: ownPosition.longitude,
                            accuracy: ownPosition.accuracy,
                          }
                        : null
                    }
                    zoom={14}
                    className="w-full h-96"
                  />
                </div>

                {/* Info note */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-400">
                    La ubicación se actualiza automáticamente y es visible para
                    el personal autorizado de la agencia.
                  </p>
                </div>
              </div>
            );
          })()}
      </main>

      {/* ── MODAL: REPORTAR INCIDENCIA ── */}
      {isIncidentModalOpen && selectedTrip && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="incident-dialog-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") setIsIncidentModalOpen(false);
              trapDialogFocus(event);
            }}
            className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-fade-in flex flex-col"
          >
            <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <AlertOctagon className="h-5 w-5 text-rose-400" />
                <h3 id="incident-dialog-title" className="font-extrabold text-white text-base">
                  Reportar Incidencia de Ruta
                </h3>
              </div>
              <button
                type="button"
                autoFocus
                aria-label="Cerrar reporte de incidencia"
                onClick={() => setIsIncidentModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form
              onSubmit={handleReportIncidentSubmit}
              className="p-6 space-y-4"
            >
              <div className="space-y-1">
                <label htmlFor="incident-type" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  Tipo de Incidencia *
                </label>
                <select
                  id="incident-type"
                  value={incidentType}
                  onChange={(e) =>
                    setIncidentType(e.target.value as IncidenciaViaje["tipo"])
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-rose-500"
                >
                  <option value="MECANICA">Falla Mecánica</option>
                  <option value="CLIMA">Condición Climática Adversa</option>
                  <option value="BLOQUEO_VIA">Bloqueo de Vía / Huayco</option>
                  <option value="ACCIDENTE">Accidente / Colisión</option>
                  <option value="RETRASO">Retraso Operativo</option>
                  <option value="OTRO">Otro Motivo</option>
                </select>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  Nivel de Gravedad *
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(["LEVE", "MODERADA", "GRAVE"] as const).map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      aria-pressed={incidentSeverity === sev}
                      onClick={() => setIncidentSeverity(sev)}
                      className={`py-2 text-[10px] font-black rounded-xl border transition-all cursor-pointer ${
                        incidentSeverity === sev
                          ? sev === "GRAVE"
                            ? "bg-red-500/20 border-red-500 text-red-300"
                            : sev === "MODERADA"
                              ? "bg-amber-500/20 border-amber-500 text-amber-300"
                              : "bg-blue-500/20 border-blue-500 text-blue-300"
                          : "border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                      }`}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="incident-description" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  Descripción Detallada *
                </label>
                <textarea
                  id="incident-description"
                  required
                  minLength={5}
                  maxLength={500}
                  rows={4}
                  value={incidentDesc}
                  onChange={(e) => setIncidentDesc(e.target.value)}
                  placeholder="Describe lo ocurrido en la ruta, ubicación estimada y estado de pasajeros..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>

              {ownPosition && (
                <p className="text-[10px] text-slate-400 font-mono">
                  📍 Ubicación GPS: {ownPosition.latitude.toFixed(5)},{" "}
                  {ownPosition.longitude.toFixed(5)} (±
                  {Math.round(ownPosition.accuracy)}m)
                </p>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsIncidentModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingIncident}
                  className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider px-5 py-2.5 rounded-xl shadow-md cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmittingIncident ? "Enviando..." : "Emitir Reporte"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

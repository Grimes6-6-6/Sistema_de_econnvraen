"use client";

import React, { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import dynamic from "next/dynamic";
import QRCode from "qrcode";
import { useDatabase, Viaje, Boleto, Encomienda } from "@/context/DatabaseContext";
import { useLocation } from "@/context/LocationContext";
import AgencySwitcher from "@/components/AgencySwitcher";
import AdminWorkspace from "@/components/AdminWorkspace";
import WalletQrPayment from "@/components/WalletQrPayment";
import TicketSalesHistory from "@/components/TicketSalesHistory";
import NotificationInbox from "@/components/NotificationInbox";
import { DataLoadError, InitialDataLoading } from "@/components/ui/DataState";
import { useFeedback } from "@/components/ui/FeedbackProvider";
import { PERMISSIONS, roleHasPermission } from "@/lib/auth/permissions";
import { buildParcelTrackingUrl, maskDni } from "@/lib/domain/parcel-receipt";
import { calculateParcelPrice } from "@/lib/domain/parcel-pricing";
import {
  formatConflictEnd,
  getPeruWallClock,
  getTripResourceConflicts,
  isTripOpenForBooking,
} from "@/lib/domain/trip-availability";
import {
  formatPaymentMethod,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  paymentMethodRequiresReference,
  type PaymentMethod,
} from "@/lib/domain/payments";
import type { OperationalDocument } from "@/lib/domain/admin";
import {
  LayoutDashboard,
  Ticket,
  Package,
  Calendar,
  Home,
  FileSpreadsheet,
  LogOut,
  CheckCircle2,
  TrendingUp,
  Printer,
  Plus,
  Search,
  CalendarDays,
  Navigation,
  ArrowRight,
  MapPin,
  X,
  Settings,
  BellRing,
  Menu,
  UserRound,
  Loader2,
} from "lucide-react";

// Map loaded client-side only (Leaflet needs window)
const LiveMap = dynamic(() => import("@/components/LiveMap"), { ssr: false });

interface DniLookupResult {
  nombres: string;
  apellidos: string;
  source: "real" | "mock";
}

const CUSTOM_PARCEL_DIMENSIONS = "CUSTOM";
const DEFAULT_PARCEL_DIMENSIONS = "30 x 20 x 15";
const PARCEL_DIMENSION_PRESETS = [
  { value: "30 x 22 x 2", label: "Sobre o documentos · 30 × 22 × 2 cm" },
  { value: DEFAULT_PARCEL_DIMENSIONS, label: "Paquete pequeño · 30 × 20 × 15 cm" },
  { value: "45 x 35 x 30", label: "Caja mediana · 45 × 35 × 30 cm" },
  { value: "60 x 45 x 40", label: "Caja grande · 60 × 45 × 40 cm" },
] as const;

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

  return {
    nombres: data.nombres,
    apellidos: data.apellidos,
    source: data.source === "mock" ? "mock" : "real",
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const {
    db,
    isInitializing,
    dataError,
    addBoleto,
    anularBoleto,
    addEncomienda,
    addViaje,
    cancelViaje,
    addRecojo,
    assignRecojoDriver,
    updateRecojoStatus,
    currentUser,
    logoutUser,
    refreshDatabase,
  } = useDatabase();
  const { notify, requestConfirmation } = useFeedback();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [documentAlerts, setDocumentAlerts] = useState<OperationalDocument[]>([]);
  const [documentAlertsError, setDocumentAlertsError] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "venta"
    | "encomiendas"
    | "viajes"
    | "recojos"
    | "reportes"
    | "flota"
    | "administracion"
  >("dashboard");
  const { locations, fleetError } = useLocation();
  const can = (permission: Parameters<typeof roleHasPermission>[1]) =>
    Boolean(currentUser && roleHasPermission(currentUser.rol, permission));

  useEffect(() => {
    if (currentUser?.rol !== "SUPER_ADMIN") {
      return;
    }

    const controller = new AbortController();
    const loadDocumentAlerts = async () => {
      try {
        const response = await fetch("/api/admin/documents", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          documents?: OperationalDocument[];
        };
        if (!response.ok || !payload.documents) {
          throw new Error("No se pudieron cargar las alertas documentarias.");
        }

        const latestByHolderAndType = new Map<string, OperationalDocument>();
        for (const document of payload.documents) {
          const key = `${document.holderType}:${document.holderId}:${document.documentType}`;
          const current = latestByHolderAndType.get(key);
          if (!current || Number(document.id.replace("DOC", "")) > Number(current.id.replace("DOC", ""))) {
            latestByHolderAndType.set(key, document);
          }
        }
        const priority = { VENCIDO: 0, PENDIENTE: 1, POR_VENCER: 2 } as const;
        setDocumentAlerts(
          [...latestByHolderAndType.values()]
            .filter((document) =>
              document.state === "VENCIDO" ||
              document.state === "PENDIENTE" ||
              document.state === "POR_VENCER",
            )
            .sort((left, right) =>
              priority[left.state as keyof typeof priority] -
                priority[right.state as keyof typeof priority] ||
              left.expiresAt.localeCompare(right.expiresAt),
            ),
        );
        setDocumentAlertsError(false);
      } catch (reason: unknown) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setDocumentAlertsError(true);
      }
    };

    void loadDocumentAlerts();
    const interval = window.setInterval(() => void loadDocumentAlerts(), 60_000);
    const refreshAlerts = () => void loadDocumentAlerts();
    window.addEventListener("operational-documents-updated", refreshAlerts);

    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("operational-documents-updated", refreshAlerts);
    };
  }, [currentUser?.rol]);

  const handleLogout = async () => {
    await logoutUser();
    router.replace("/login");
    router.refresh();
  };

  const getTodayDateString = () => getPeruWallClock().date;

  // ==========================================================================
  // TAB: OVERVIEW (DASHBOARD)
  // ==========================================================================
  const todayStr = getTodayDateString();

  const kpis = useMemo(() => {
    const todayTrips = db.viajes.filter(
      (v) => v.fecha === todayStr && v.estado !== "cancelado",
    );
    const todayTripsIds = todayTrips.map((v) => v.id);
    const todayBoletos = db.boletos.filter(
      (b) => todayTripsIds.includes(b.id_viaje) && b.estado !== "anulado",
    );
    const pendingParcels = db.encomiendas.filter(
      (e) => e.estado !== "entregado",
    );

    const pasajesRevenue = todayBoletos.reduce(
      (sum, b) => sum + b.precio,
      0,
    );
    const todayParcels = db.encomiendas.filter(
      (e) => e.fechaRegistro === todayStr,
    );
    const parcelsRevenue = todayParcels.reduce(
      (sum, p) => sum + p.costo,
      0,
    );

    return {
      viajes: todayTrips.length,
      pasajes: todayBoletos.length,
      encomiendas: pendingParcels.length,
      ingresos: pasajesRevenue + parcelsRevenue,
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
  const [ticketPaymentMethod, setTicketPaymentMethod] =
    useState<PaymentMethod>("EFECTIVO");
  const [ticketPaymentReference, setTicketPaymentReference] = useState("");
  const [emittedBoleto, setEmittedBoleto] = useState<Boleto | null>(null);
  const [isQueryingReniec, setIsQueryingReniec] = useState(false);
  const [isQueryingReniecParcel, setIsQueryingReniecParcel] = useState<
    "rem" | "dest" | null
  >(null);

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
    setTicketPaymentMethod("EFECTIVO");
    setTicketPaymentReference("");
    setEmittedBoleto(null);
  };

  const getBookedSeats = (tripId: string) => {
    return db.boletos
      .filter((b) => b.id_viaje === tripId && b.estado !== "anulado")
      .map((b) => b.asiento);
  };

  const searchPassengerDni = async () => {
    if (passengerDni.length !== 8 || !/^\d+$/.test(passengerDni)) {
      notify({
        type: "warning",
        title: "DNI incompleto",
        message: "Ingresa exactamente 8 dígitos para realizar la consulta.",
      });
      return;
    }

    setIsQueryingReniec(true);

    try {
      const data = await lookupDni(passengerDni);
      setPassengerNombres(data.nombres);
      setPassengerApellidos(data.apellidos);
      if (data.source === "mock") {
        notify({
          type: "warning",
          title: "Consulta de prueba",
          message: "Verifica los nombres antes de emitir el boleto.",
        });
      }
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo consultar el DNI",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsQueryingReniec(false);
    }
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrip || selectedSeat === 0) {
      notify({
        type: "warning",
        title: "Selecciona un asiento",
        message: "Elige uno de los cuatro asientos disponibles antes de continuar.",
      });
      return;
    }

    if (!isTripOpenForBooking(selectedTrip)) {
      notify({
        type: "warning",
        title: "La salida ya no está disponible",
        message: "La hora de salida pasó o el viaje ya inició. Selecciona otro viaje.",
      });
      return;
    }

    setPendingAction("booking");
    try {
      const res = await addBoleto({
        id_viaje: selectedTrip.id,
        asiento: selectedSeat,
        pasajeroDni: passengerDni,
        pasajeroNombres: passengerNombres,
        pasajeroApellidos: passengerApellidos,
        pasajeroTelefono: passengerTelefono,
        metodoPago: ticketPaymentMethod,
        referenciaPago: ticketPaymentReference.trim(),
      });
      if (res) {
        setEmittedBoleto(res);
        setWizardStep(3);
        notify({
          type: "success",
          title: "Boleto emitido",
          message: `${res.codigo} · Asiento ${res.asiento}`,
        });
      }
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo emitir el boleto",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  // ==========================================================================
  // TAB: ENCOMIENDAS (PARCELS)
  // ==========================================================================
  const [searchParcelText, setSearchParcelText] = useState("");
  const [filterParcelState, setFilterParcelState] = useState("");
  const [isParcelModalOpen, setIsParcelModalOpen] = useState(false);
  const [emittedParcel, setEmittedParcel] = useState<Encomienda | null>(null);
  const [parcelQrDataUrl, setParcelQrDataUrl] = useState("");

  // Form states
  const [parcelRemDni, setParcelRemDni] = useState("");
  const [parcelRemNombre, setParcelRemNombre] = useState("");
  const [parcelRemTelf, setParcelRemTelf] = useState("");
  const [parcelDestDni, setParcelDestDni] = useState("");
  const [parcelDestNombre, setParcelDestNombre] = useState("");
  const [parcelDestTelf, setParcelDestTelf] = useState("");
  const [parcelTripId, setParcelTripId] = useState("");
  const [parcelPeso, setParcelPeso] = useState("");
  const [parcelDimensionPreset, setParcelDimensionPreset] = useState(
    DEFAULT_PARCEL_DIMENSIONS,
  );
  const [parcelDimensiones, setParcelDimensiones] = useState(
    DEFAULT_PARCEL_DIMENSIONS,
  );
  const [parcelValor, setParcelValor] = useState("0");
  const [parcelPaymentMethod, setParcelPaymentMethod] =
    useState<PaymentMethod>("EFECTIVO");
  const [parcelPaymentReference, setParcelPaymentReference] = useState("");
  const [parcelDesc, setParcelDesc] = useState("");

  const parcelPriceQuote = useMemo(() => {
    const trip = db.viajes.find((item) => item.id === parcelTripId);
    const route = trip
      ? db.rutas.find((item) => item.id === trip.id_ruta)
      : null;
    if (!route) return null;

    return calculateParcelPrice({
      distanceKm: Number.parseFloat(route.distancia.replace(",", ".")),
      actualWeightKg: Number(parcelPeso),
      dimensions: parcelDimensiones,
      declaredValue: Number(parcelValor),
    });
  }, [
    db.rutas,
    db.viajes,
    parcelDimensiones,
    parcelPeso,
    parcelTripId,
    parcelValor,
  ]);
  const parcelCosto = parcelPriceQuote?.total.toFixed(2) ?? "";

  const filteredParcels = useMemo(
    () =>
      db.encomiendas.filter((parcel) => {
        const query = searchParcelText.trim().toLowerCase();
        const matchesText =
          !query ||
          parcel.codigo_tracking.toLowerCase().includes(query) ||
          parcel.destinatarioDni.includes(query) ||
          parcel.remitenteDni.includes(query);
        const matchesState =
          !filterParcelState || parcel.estado === filterParcelState;
        return matchesText && matchesState;
      }),
    [db.encomiendas, filterParcelState, searchParcelText],
  );

  const parcelReceiptTrip = emittedParcel
    ? db.viajes.find((trip) => trip.id === emittedParcel.id_viaje)
    : null;
  const parcelReceiptRoute = parcelReceiptTrip
    ? db.rutas.find((route) => route.id === parcelReceiptTrip.id_ruta)
    : null;

  const prepareParcelReceipt = async (parcel: Encomienda) => {
    setEmittedParcel(parcel);
    try {
      const trackingUrl = buildParcelTrackingUrl(
        window.location.origin,
        parcel.codigo_tracking,
      );
      const dataUrl = await QRCode.toDataURL(trackingUrl, {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 256,
        color: { dark: "#020617", light: "#ffffff" },
      });
      setParcelQrDataUrl(dataUrl);
    } catch {
      setParcelQrDataUrl("");
      notify({
        type: "warning",
        title: "Encomienda registrada sin QR",
        message: "Puedes volver a generar el recibo desde la lista de encomiendas.",
      });
    }
  };

  const searchParcelClient = async (role: "rem" | "dest") => {
    const dni = role === "rem" ? parcelRemDni : parcelDestDni;
    if (dni.length !== 8 || !/^\d+$/.test(dni)) {
      notify({
        type: "warning",
        title: "DNI incompleto",
        message: "Ingresa exactamente 8 dígitos para realizar la consulta.",
      });
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
      if (data.source === "mock") {
        notify({
          type: "warning",
          title: "Consulta de prueba",
          message: "Verifica los nombres antes de registrar la encomienda.",
        });
      }
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo consultar el DNI",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsQueryingReniecParcel(null);
    }
  };

  const handleParcelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parcelRemDni || !parcelDestDni || !parcelTripId) {
      notify({
        type: "warning",
        title: "Completa los datos obligatorios",
        message: "Se requieren remitente, destinatario y viaje.",
      });
      return;
    }
    const assignedTrip = db.viajes.find((trip) => trip.id === parcelTripId);
    if (!assignedTrip || !isTripOpenForBooking(assignedTrip)) {
      notify({
        type: "warning",
        title: "La salida ya no está disponible",
        message: "La hora de salida pasó o el viaje ya inició. Asigna la encomienda a otro viaje.",
      });
      return;
    }
    if (!parcelPriceQuote) {
      notify({
        type: "warning",
        title: "No se pudo calcular la tarifa",
        message:
          "Selecciona el viaje e ingresa un peso y tres dimensiones válidas, por ejemplo 30 x 20 x 15.",
      });
      return;
    }

    setPendingAction("parcel");
    try {
      const res = await addEncomienda({
        id_viaje: parcelTripId,
        remitenteDni: parcelRemDni,
        remitenteNombre: parcelRemNombre,
        remitenteTelefono: parcelRemTelf,
        destinatarioDni: parcelDestDni,
        destinatarioNombre: parcelDestNombre,
        destinatarioTelefono: parcelDestTelf,
        peso: parseFloat(parcelPeso) || 1,
        dimensiones: parcelDimensiones,
        valor: parseFloat(parcelValor) || 0,
        costo: parcelPriceQuote.total,
        metodoPago: parcelPaymentMethod,
        referenciaPago: parcelPaymentReference.trim(),
        descripcion: parcelDesc,
      });

      if (res) {
        await prepareParcelReceipt(res);
        notify({
          type: "success",
          title: "Encomienda registrada",
          message: `Recibo con QR generado: ${res.codigo_tracking}`,
          duration: 7000,
        });
        setIsParcelModalOpen(false);
        setParcelRemDni("");
        setParcelRemNombre("");
        setParcelRemTelf("");
        setParcelDestDni("");
        setParcelDestNombre("");
        setParcelDestTelf("");
        setParcelTripId("");
        setParcelPeso("");
        setParcelDimensionPreset(DEFAULT_PARCEL_DIMENSIONS);
        setParcelDimensiones(DEFAULT_PARCEL_DIMENSIONS);
        setParcelValor("0");
        setParcelPaymentMethod("EFECTIVO");
        setParcelPaymentReference("");
        setParcelDesc("");
      }
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo registrar la encomienda",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  // ==========================================================================
  // TAB: VIAJES (TRIPS)
  // ==========================================================================
  const [isTripModalOpen, setIsTripModalOpen] = useState(false);
  const [tripRutaId, setTripRutaId] = useState("");
  const [tripVehiculoId, setTripVehiculoId] = useState("");
  const [tripConductorId, setTripConductorId] = useState("");
  const [tripFecha, setTripFecha] = useState(getTodayDateString());
  const [tripHora, setTripHora] = useState("06:00");
  const [tripPrecio, setTripPrecio] = useState("50");
  const [tripAvailabilityNow, setTripAvailabilityNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(
      () => setTripAvailabilityNow(Date.now()),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isTripModalOpen && !isParcelModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isTripModalOpen, isParcelModalOpen]);

  const openTripModal = () => {
    const now = Date.now();
    const nextHalfHour = Math.ceil((now + 60_000) / 1_800_000) * 1_800_000;
    const departure = getPeruWallClock(new Date(nextHalfHour));
    setTripAvailabilityNow(now);
    setTripFecha(departure.date);
    setTripHora(departure.time);
    setTripRutaId("");
    setTripVehiculoId("");
    setTripConductorId("");
    setTripPrecio("50");
    setIsTripModalOpen(true);
  };

  const tripResourceConflicts = useMemo(
    () =>
      getTripResourceConflicts({
        routes: db.rutas,
        trips: db.viajes,
        candidate: {
          routeId: tripRutaId,
          date: tripFecha,
          time: tripHora,
        },
        referenceNow: getPeruWallClock(new Date(tripAvailabilityNow)),
      }),
    [db.rutas, db.viajes, tripAvailabilityNow, tripFecha, tripHora, tripRutaId],
  );

  const selectedTripRoute = useMemo(
    () => db.rutas.find((route) => route.id === tripRutaId),
    [db.rutas, tripRutaId],
  );

  const availableTripVehicles = db.vehiculos.filter(
    (vehicle) => !tripResourceConflicts.vehicles.has(vehicle.id),
  ).length;
  const availableTripDrivers = db.conductores.filter(
    (driver) => !tripResourceConflicts.drivers.has(driver.id),
  ).length;

  const handleTripSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripRutaId || !tripVehiculoId || !tripConductorId) {
      notify({
        type: "warning",
        title: "Completa la programación",
        message: "Selecciona ruta, vehículo y conductor.",
      });
      return;
    }

    if (new Date(`${tripFecha}T${tripHora}:00-05:00`).getTime() < Date.now()) {
      notify({
        type: "warning",
        title: "La hora de salida ya pasó",
        message: "Selecciona una fecha y hora futuras para programar el viaje.",
      });
      return;
    }

    const currentConflicts = getTripResourceConflicts({
      routes: db.rutas,
      trips: db.viajes,
      candidate: { routeId: tripRutaId, date: tripFecha, time: tripHora },
    });
    const vehicleConflict = currentConflicts.vehicles.get(tripVehiculoId);
    const driverConflict = currentConflicts.drivers.get(tripConductorId);
    if (vehicleConflict || driverConflict) {
      const details = [
        vehicleConflict
          ? `El vehículo está ocupado hasta ${formatConflictEnd(vehicleConflict, tripFecha)}.`
          : "",
        driverConflict
          ? `El conductor está ocupado hasta ${formatConflictEnd(driverConflict, tripFecha)}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      notify({
        type: "warning",
        title: "Horario no disponible",
        message: details,
      });
      return;
    }

    setPendingAction("trip");
    try {
      const res = await addViaje({
        id_ruta: tripRutaId,
        id_vehiculo: tripVehiculoId,
        id_conductor: tripConductorId,
        fecha: tripFecha,
        hora: tripHora,
        precio: parseFloat(tripPrecio) || 50,
      });

      if (res) {
        notify({
          type: "success",
          title: "Viaje programado",
          message: `${tripFecha} a las ${tripHora}`,
        });
        setIsTripModalOpen(false);
        setTripRutaId("");
        setTripVehiculoId("");
        setTripConductorId("");
        setTripFecha(getTodayDateString());
        setTripHora("06:00");
        setTripPrecio("50");
      }
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo programar el viaje",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  // ==========================================================================
  // TAB: RECOJOS A DOMICILIO
  // ==========================================================================
  const [isNewPickupModalOpen, setIsNewPickupModalOpen] = useState(false);
  const [isRecojoModalOpen, setIsRecojoModalOpen] = useState(false);
  const [recojoSelectedId, setRecojoSelectedId] = useState<string | null>(null);
  const [recojoDriverSelect, setRecojoDriverSelect] = useState("");
  const [pickupDni, setPickupDni] = useState("");
  const [pickupName, setPickupName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [pickupDate, setPickupDate] = useState(getTodayDateString());
  const [pickupAddress, setPickupAddress] = useState("");
  const [pickupDescription, setPickupDescription] = useState("");
  const [isQueryingPickupDni, setIsQueryingPickupDni] = useState(false);
  const lastQueriedPickupDni = React.useRef("");

  useEffect(() => {
    if (pickupDni.length === 8 && isNewPickupModalOpen) {
      if (lastQueriedPickupDni.current === pickupDni) return;
      lastQueriedPickupDni.current = pickupDni;

      let isCurrent = true;
      setIsQueryingPickupDni(true);
      lookupDni(pickupDni)
        .then((data) => {
          if (!isCurrent) return;
          const fullName = `${data.nombres} ${data.apellidos}`.trim();
          setPickupName(fullName);
          if (data.source === "mock") {
            notify({
              type: "warning",
              title: "Consulta de prueba",
              message: "Verifica el nombre antes de registrar la solicitud.",
            });
          }
        })
        .catch((error) => {
          if (!isCurrent) return;
          notify({
            type: "warning",
            title: "No se pudo consultar el DNI",
            message:
              error instanceof Error
                ? error.message
                : "Ingresa el nombre completo manualmente.",
          });
        })
        .finally(() => {
          if (isCurrent) setIsQueryingPickupDni(false);
        });

      return () => {
        isCurrent = false;
      };
    }
  }, [pickupDni, isNewPickupModalOpen, notify]);

  const submitNewPickup = async (event: React.FormEvent) => {
    event.preventDefault();
    setPendingAction("pickup");
    try {
      await addRecojo({
        dni: pickupDni,
        nombre: pickupName,
        telefono: pickupPhone,
        fecha: pickupDate,
        direccion: pickupAddress,
        descripcion: pickupDescription,
      });
      setIsNewPickupModalOpen(false);
      setPickupDni("");
      setPickupName("");
      setPickupPhone("");
      setPickupDate(getTodayDateString());
      setPickupAddress("");
      setPickupDescription("");
      lastQueriedPickupDni.current = "";
      notify({
        type: "success",
        title: "Recojo registrado",
        message: "La solicitud quedó lista para asignar a un conductor.",
      });
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo registrar el recojo",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  const assignDriverToRecojo = async (recojoId: string) => {
    setRecojoSelectedId(recojoId);
    setIsRecojoModalOpen(true);
  };

  const submitAssignDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recojoSelectedId || !recojoDriverSelect) {
      notify({ type: "warning", title: "Selecciona un conductor" });
      return;
    }
    setPendingAction("assign-pickup");
    try {
      await assignRecojoDriver(recojoSelectedId, recojoDriverSelect);
      setIsRecojoModalOpen(false);
      setRecojoSelectedId(null);
      setRecojoDriverSelect("");
      notify({
        type: "success",
        title: "Conductor asignado",
        message: "El recojo ya aparece en la operación del conductor.",
      });
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo asignar el conductor",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  const changeRecojoStatus = async (
    recojoId: string,
    newState: "en_camino" | "completado" | "cancelado",
  ) => {
    if (newState === "cancelado") {
      const result = await requestConfirmation({
        title: "Cancelar solicitud de recojo",
        message:
          "La solicitud dejará de aparecer como pendiente para la operación. Esta acción quedará registrada.",
        confirmLabel: "Cancelar solicitud",
        cancelLabel: "Volver",
        tone: "danger",
      });
      if (!result.confirmed) return;
    }
    setPendingAction(`pickup-${recojoId}`);
    try {
      await updateRecojoStatus(recojoId, newState);
      notify({
        type: "success",
        title: "Estado actualizado",
        message: `El recojo ahora figura como ${newState.replace("_", " ")}.`,
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

  const handleCancelTicket = async (ticket: Boleto) => {
    const canApproveCancellation = can(PERMISSIONS.TICKET_CANCEL_APPROVE);
    const result = await requestConfirmation({
      title: canApproveCancellation
        ? `Anular boleto ${ticket.codigo}`
        : `Solicitar anulación de ${ticket.codigo}`,
      message:
        canApproveCancellation
          ? "Esta acción libera el asiento y deja una constancia de auditoría. Registra el motivo informado al pasajero."
          : "Un administrador revisará la solicitud. El asiento seguirá ocupado hasta que sea aprobada.",
      confirmLabel: canApproveCancellation ? "Anular boleto" : "Enviar solicitud",
      cancelLabel: "Conservar boleto",
      tone: "danger",
      input: {
        label: "Motivo de anulación",
        placeholder: "Ej.: Solicitud del pasajero",
        minLength: 5,
      },
    });
    if (!result.confirmed) return;

    setPendingAction(`cancel-ticket-${ticket.id}`);
    try {
      const outcome = await anularBoleto(ticket.id, result.value);
      notify({
        type: "success",
        title: outcome === "cancelled" ? "Boleto anulado" : "Solicitud enviada",
        message:
          outcome === "cancelled"
            ? `${ticket.codigo} quedó anulado y el asiento fue liberado.`
            : `La anulación de ${ticket.codigo} quedó pendiente de aprobación administrativa.`,
      });
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo anular el boleto",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleCancelTrip = async (trip: Viaje) => {
    const result = await requestConfirmation({
      title: `Cancelar viaje ${trip.id}`,
      message:
        "El viaje dejará de estar disponible para ventas. Verifica antes si existen pasajeros o encomiendas que deban reprogramarse.",
      confirmLabel: "Cancelar viaje",
      cancelLabel: "Mantener viaje",
      tone: "danger",
      input: {
        label: "Motivo de cancelación",
        placeholder: "Ej.: Cierre temporal de la vía",
        minLength: 5,
      },
    });
    if (!result.confirmed) return;

    setPendingAction(`cancel-trip-${trip.id}`);
    try {
      await cancelViaje(trip.id, result.value);
      notify({
        type: "success",
        title: "Viaje cancelado",
        message: `${trip.id} ya no admite nuevas operaciones.`,
      });
    } catch (error) {
      notify({
        type: "error",
        title: "No se pudo cancelar el viaje",
        message: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPendingAction(null);
    }
  };

  // ==========================================================================
  // TAB: REPORTES FINANCIEROS
  // ==========================================================================
  const [repStart, setRepStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return formatDateInput(d);
  });
  const [repEnd, setRepEnd] = useState(getTodayDateString());
  const [repRouteId, setRepRouteId] = useState("");
  const reportRangeIsValid = repStart <= repEnd;

  const repData = useMemo(() => {
    const boletos = db.boletos.filter((b) => {
      if (!reportRangeIsValid) return false;
      if (b.estado === "anulado") return false;
      const trip = db.viajes.find((v) => v.id === b.id_viaje);
      if (!trip) return false;
      if (repRouteId && trip.id_ruta !== repRouteId) return false;
      return trip.fecha >= repStart && trip.fecha <= repEnd;
    });

    const encomiendas = db.encomiendas.filter((e) => {
      if (!reportRangeIsValid) return false;
      if (repRouteId) {
        const trip = db.viajes.find((v) => v.id === e.id_viaje);
        if (!trip || trip.id_ruta !== repRouteId) return false;
      }
      return e.fechaRegistro >= repStart && e.fechaRegistro <= repEnd;
    });

    const pasajesTotal = boletos.reduce((sum, b) => sum + b.precio, 0);
    const encomiendasTotal = encomiendas.reduce((sum, e) => sum + e.costo, 0);

    return {
      boletos,
      encomiendas,
      pasajesTotal,
      encomiendasTotal,
      total: pasajesTotal + encomiendasTotal,
    };
  }, [db, repStart, repEnd, repRouteId, reportRangeIsValid]);

  const exportFinancialReport = () => {
    if (!reportRangeIsValid) {
      notify({
        type: "warning",
        title: "Rango de fechas inválido",
        message: "La fecha inicial no puede ser posterior a la fecha final.",
      });
      return;
    }

    const escapeCell = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const rows: Array<Array<string | number>> = [
      [
        "Tipo",
        "Fecha",
        "Código",
        "Ruta",
        "Cliente",
        "Detalle",
        "Método de pago",
        "Referencia",
        "Monto (S/)",
      ],
      ...repData.boletos.map((ticket) => {
        const trip = db.viajes.find((item) => item.id === ticket.id_viaje);
        const route = db.rutas.find((item) => item.id === trip?.id_ruta);
        return [
          "Pasaje",
          trip?.fecha ?? "",
          ticket.codigo,
          route ? `${route.origen} - ${route.destino}` : "Sin ruta",
          `${ticket.pasajeroNombres} ${ticket.pasajeroApellidos}`.trim(),
          `Asiento ${ticket.asiento}`,
          formatPaymentMethod(ticket.metodoPago),
          ticket.referenciaPago,
          ticket.precio.toFixed(2),
        ];
      }),
      ...repData.encomiendas.map((parcel) => {
        const trip = db.viajes.find((item) => item.id === parcel.id_viaje);
        const route = db.rutas.find((item) => item.id === trip?.id_ruta);
        return [
          "Encomienda",
          parcel.fechaRegistro,
          parcel.codigo_tracking,
          route ? `${route.origen} - ${route.destino}` : "Sin ruta",
          parcel.destinatarioNombre,
          parcel.descripcion,
          formatPaymentMethod(parcel.metodoPago),
          parcel.referenciaPago,
          parcel.costo.toFixed(2),
        ];
      }),
      [],
      ["Resumen", "Pasajes", repData.pasajesTotal.toFixed(2)],
      ["Resumen", "Encomiendas", repData.encomiendasTotal.toFixed(2)],
      ["Resumen", "Total", repData.total.toFixed(2)],
    ];
    const csv = `\uFEFF${rows
      .map((row) => row.map(escapeCell).join(";"))
      .join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reporte-econnvrae-${repStart}-${repEnd}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify({
      type: "success",
      title: "Reporte exportado",
      message: "El archivo CSV es compatible con Microsoft Excel.",
    });
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
    <div className="corporate-app flex min-h-screen flex-col bg-[#f3eee4] text-slate-800 lg:flex-row">
      {/* ── SIDEBAR NAVIGATION ── */}
      <aside className="corporate-sidebar no-print relative z-30 flex w-full shrink-0 flex-col border-b border-[#ddd2c2] bg-[#fffaf2] lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-r lg:border-b-0">
        {/* Brand */}
        <div className="flex h-[72px] items-center justify-between border-b-4 border-[#c7a45a] bg-white px-4">
          <div className="flex min-w-0 items-center">
            <Image
              src="/econnvrae-logo.png"
              alt="ECONNVRAE"
              width={2086}
              height={754}
              priority
              className="h-12 w-auto max-w-[185px] object-contain object-left"
            />
          </div>
          <button
            type="button"
            onClick={() => setIsMobileNavOpen((open) => !open)}
            aria-expanded={isMobileNavOpen}
            aria-controls="dashboard-navigation"
            aria-label={isMobileNavOpen ? "Cerrar menú" : "Abrir menú"}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-700 lg:hidden"
          >
            {isMobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Nav list */}
        <nav
          id="dashboard-navigation"
          className={`${isMobileNavOpen ? "flex" : "hidden"} flex-col gap-1 overflow-y-auto p-3 lg:flex lg:grow lg:p-4`}
        >
          {(
            [
              {
                id: "dashboard",
                label: "Dashboard",
                icon: LayoutDashboard,
              },
              {
                id: "viajes",
                label: "Itinerario de Viajes",
                icon: Calendar,
                permission: PERMISSIONS.TRIP_VIEW,
              },
              {
                id: "venta",
                label: "Venta de Pasajes",
                icon: Ticket,
                permission: PERMISSIONS.TICKET_SELL,
              },
              {
                id: "encomiendas",
                label: "Encomiendas",
                icon: Package,
                permission: PERMISSIONS.PARCEL_CREATE,
              },
              {
                id: "recojos",
                label: "Recojos a Domicilio",
                icon: Home,
                permission: PERMISSIONS.PICKUP_CREATE,
              },
              {
                id: "flota",
                label: "Flota en Vivo",
                icon: Navigation,
                permission: PERMISSIONS.FLEET_VIEW,
              },
              {
                id: "reportes",
                label: "Reportes e Ingresos",
                icon: FileSpreadsheet,
                permission: PERMISSIONS.REPORTS_AGENCY,
              },
              {
                id: "administracion",
                label: "Administración",
                icon: Settings,
                permission: PERMISSIONS.USER_MANAGE,
              },
            ] as const
          )
            .filter((tab) => !("permission" in tab) || can(tab.permission))
            .map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setIsMobileNavOpen(false);
                }}
                aria-current={isActive ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-md border-l-4 px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                  isActive
                    ? "border-[#c7a45a] bg-white text-slate-950"
                    : "border-transparent text-slate-600 hover:bg-[#f3eadb] hover:text-slate-950"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? "text-[#8b641d]" : "text-slate-500"
                  }`}
                />
                <span>{tab.label}</span>
                {tab.id === "flota" &&
                  locations.filter((l) => l.isActive).length > 0 && (
                    <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  )}
                {tab.id === "administracion" && documentAlerts.length > 0 && (
                  <span className="ml-auto min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[9px] font-black text-white">
                    {documentAlerts.length > 99 ? "99+" : documentAlerts.length}
                  </span>
                )}
              </button>
            );
            })}
        </nav>

        <div className={`${isMobileNavOpen ? "block" : "hidden"} border-t border-[#ddd2c2] px-3 pb-3 pt-3 lg:hidden`}>
          <div className="mb-3 flex items-center gap-3 rounded-md bg-[#f3eadb] px-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d8bc82] text-sm font-bold text-slate-950">
              {currentUser?.nombres?.[0] || "U"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {currentUser
                  ? `${currentUser.nombres} ${currentUser.apellidos}`
                  : "Usuario"}
              </p>
              <p className="truncate text-xs text-slate-600">
                {currentUser?.agenciaNombre || "Agencia activa"}
              </p>
            </div>
          </div>
          <div>
            <AgencySwitcher />
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
          </div>
        </div>

        {/* User profile / Agency panel in Sidebar footer */}
        <div className="hidden space-y-3 border-t border-[#ddd2c2] bg-[#f3eadb] p-4 lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d8bc82] text-sm font-bold text-slate-950">
              {currentUser ? currentUser.nombres[0] : "U"}
            </div>
            <div className="min-w-0 grow">
              <h4 className="truncate text-sm font-semibold text-slate-900">
                {currentUser
                  ? `${currentUser.nombres} ${currentUser.apellidos}`
                  : "Usuario"}
              </h4>
              <span className="block text-xs text-slate-600">
                {currentUser ? currentUser.rol.replaceAll("_", " ") : "Operador"}
              </span>
            </div>
          </div>

          <AgencySwitcher />

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── WORKSPACE CONTENT AREA ── */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex min-h-[72px] items-center justify-between gap-4 border-b-4 border-[#c7a45a] bg-white px-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Centro de operaciones</p>
            <p className="truncate text-xs text-slate-500">
              {currentUser?.agenciaNombre || "Agencia activa"}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {currentUser && can(PERMISSIONS.FLEET_MANAGE) && <NotificationInbox key={`${currentUser.id}:${currentUser.agenciaId}`} onNavigate={() => setActiveTab("administracion")} />}
            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <UserRound className="h-4.5 w-4.5" />
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="max-w-44 truncate text-sm font-semibold text-slate-900">
                  {currentUser ? `${currentUser.nombres} ${currentUser.apellidos}` : "Usuario"}
                </p>
                <p className="text-xs text-slate-500">
                  {currentUser ? currentUser.rol.replaceAll("_", " ") : "Operador"}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="relative z-10 mx-auto w-full max-w-[1440px] grow p-4 sm:p-6 lg:p-8">
        {/* ================================================================== */}
        {/* TAB 1: OVERVIEW DASHBOARD */}
        {/* ================================================================== */}
        {activeTab === "dashboard" && (
          <div className="no-print space-y-5 animate-fade-in">
            <section className="flex flex-col gap-4 border-b border-slate-200 pb-5 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="mb-1 text-sm font-medium text-slate-500">
                  {new Date().toLocaleDateString("es-PE", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
                <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">
                  Resumen de hoy
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Viajes, ventas y entregas de {currentUser?.agenciaNombre || "la agencia activa"}.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {can(PERMISSIONS.TRIP_VIEW) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("viajes")}
                    className="inline-flex items-center gap-2 rounded-md bg-[#d8bc82] px-3.5 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#c9a968]"
                  >
                    <CalendarDays className="h-4 w-4" />
                    {can(PERMISSIONS.TRIP_MANAGE) ? "Programar viaje" : "Ver itinerario"}
                  </button>
                )}
                {can(PERMISSIONS.TICKET_SELL) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("venta")}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Ticket className="h-4 w-4" /> Venta de pasaje
                  </button>
                )}
                {can(PERMISSIONS.PARCEL_CREATE) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("encomiendas")}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Package className="h-4 w-4" /> Nueva encomienda
                  </button>
                )}
              </div>
            </section>

            {currentUser?.rol === "SUPER_ADMIN" && documentAlerts.length > 0 && (
              <section role="alert" className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-slate-800">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                    <div>
                      <h2 className="text-sm font-semibold">
                        {documentAlerts.length} documento{documentAlerts.length === 1 ? " requiere" : "s requieren"} atención
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Hay documentos pendientes de revisión, próximos a vencer o vencidos.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("administracion")}
                    className="inline-flex items-center gap-1.5 self-start rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 sm:self-auto"
                  >
                    Revisar documentos <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </section>
            )}

            {currentUser?.rol === "SUPER_ADMIN" && documentAlertsError && (
              <section role="alert" className="border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
                No se pudieron comprobar las vigencias documentarias. Revisa la conexión antes de programar viajes.
              </section>
            )}

            <section aria-label="Indicadores del día" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Viajes de hoy", value: String(kpis.viajes), icon: Calendar, tone: "bg-amber-50 text-amber-800" },
                { label: "Pasajes vendidos", value: String(kpis.pasajes), icon: Ticket, tone: "bg-stone-100 text-stone-700" },
                { label: "Encomiendas pendientes", value: String(kpis.encomiendas), icon: Package, tone: "bg-yellow-50 text-yellow-800" },
                { label: "Ingresos del día", value: `S/ ${kpis.ingresos.toFixed(2)}`, icon: TrendingUp, tone: "bg-[#d8bc82] text-slate-950" },
              ].map((metric) => {
                const Icon = metric.icon;
                return (
                  <article key={metric.label} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${metric.tone}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xl font-bold text-slate-950">{metric.value}</p>
                      <p className="truncate text-xs font-medium text-slate-500">{metric.label}</p>
                    </div>
                  </article>
                );
              })}
            </section>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.65fr)]">
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3.5 sm:px-5">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">Próximas salidas</h2>
                    <p className="text-xs text-slate-500">Itinerario programado para hoy</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("viajes")}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#7b5e27] hover:underline"
                  >
                    Ver itinerario <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                {db.viajes.filter((trip) => trip.fecha === todayStr && trip.estado === "programado").length === 0 ? (
                  <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
                    <CalendarDays className="mb-3 h-8 w-8 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-800">Todavía no hay salidas programadas</p>
                    <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                      Crea el itinerario del día para habilitar la venta de pasajes y asignar conductores.
                    </p>
                    {can(PERMISSIONS.TRIP_MANAGE) && (
                      <button
                        type="button"
                        onClick={() => setActiveTab("viajes")}
                        className="mt-4 rounded-md bg-[#d8bc82] px-3.5 py-2 text-sm font-semibold text-slate-950 hover:bg-[#c9a968]"
                      >
                        Programar primer viaje
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 sm:px-5">Hora</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Ruta</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Conductor</th>
                          <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">Ocupación</th>
                        </tr>
                      </thead>
                      <tbody>
                        {db.viajes
                          .filter((trip) => trip.fecha === todayStr && trip.estado === "programado")
                          .sort((left, right) => left.hora.localeCompare(right.hora))
                          .map((trip) => {
                            const route = db.rutas.find((item) => item.id === trip.id_ruta);
                            const driver = db.conductores.find((item) => item.id === trip.id_conductor);
                            const booked = getBookedSeats(trip.id).length;
                            return (
                              <tr key={trip.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                                <td className="px-4 py-3 text-sm font-semibold text-slate-950 sm:px-5">{trip.hora}</td>
                                <td className="px-4 py-3 text-sm text-slate-700">
                                  {route ? `${route.origen} — ${route.destino}` : "Ruta sin asignar"}
                                </td>
                                <td className="px-4 py-3 text-sm text-slate-600">{driver?.nombres || "Por asignar"}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${booked >= 4 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                                    {booked} de 4
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <aside className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3.5">
                  <h2 className="text-base font-semibold text-slate-950">Atención operativa</h2>
                  <p className="text-xs text-slate-500">Pendientes que requieren seguimiento</p>
                </div>
                <div className="divide-y divide-slate-100">
                  <button type="button" onClick={() => setActiveTab("encomiendas")} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-yellow-50 text-yellow-800"><Package className="h-4.5 w-4.5" /></span>
                    <span className="min-w-0 grow"><b className="block text-sm text-slate-900">{kpis.encomiendas} encomiendas</b><span className="text-xs text-slate-500">Pendientes de entrega</span></span>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </button>
                  {currentUser?.rol === "SUPER_ADMIN" && (
                    <button type="button" onClick={() => setActiveTab("administracion")} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-50 text-amber-700"><BellRing className="h-4.5 w-4.5" /></span>
                      <span className="min-w-0 grow"><b className="block text-sm text-slate-900">{documentAlerts.length} documentos</b><span className="text-xs text-slate-500">Por revisar o vencer</span></span>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </button>
                  )}
                  {can(PERMISSIONS.FLEET_VIEW) && (
                    <button type="button" onClick={() => setActiveTab("flota")} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-stone-100 text-stone-700"><Navigation className="h-4.5 w-4.5" /></span>
                      <span className="min-w-0 grow"><b className="block text-sm text-slate-900">{locations.filter((location) => location.isActive).length} unidades</b><span className="text-xs text-slate-500">Reportando ubicación</span></span>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </button>
                  )}
                </div>
              </aside>
            </div>

            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3.5 sm:px-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Encomiendas recientes</h2>
                  <p className="text-xs text-slate-500">Últimos registros de la agencia</p>
                </div>
                <button type="button" onClick={() => setActiveTab("encomiendas")} className="inline-flex items-center gap-1 text-sm font-semibold text-[#7b5e27] hover:underline">
                  Ver todas <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {db.encomiendas.length === 0 ? (
                <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center">
                  <Package className="mb-3 h-7 w-7 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-800">No hay encomiendas registradas</p>
                  <p className="mt-1 text-xs text-slate-500">Los envíos nuevos aparecerán aquí para su seguimiento.</p>
                  {can(PERMISSIONS.PARCEL_CREATE) && (
                    <button type="button" onClick={() => setActiveTab("encomiendas")} className="mt-3 text-sm font-semibold text-[#7b5e27] hover:underline">
                      Registrar una encomienda
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-slate-50">
                      <tr className="border-b border-slate-200">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 sm:px-5">Código</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Destinatario</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Descripción</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...db.encomiendas].reverse().slice(0, 5).map((parcel) => {
                        const stateColors: Record<string, string> = {
                          registrado: "bg-blue-50 text-blue-700",
                          recojo_domicilio: "bg-violet-50 text-violet-700",
                          en_transito: "bg-amber-50 text-amber-700",
                          en_destino: "bg-sky-50 text-sky-700",
                          entregado: "bg-emerald-50 text-emerald-700",
                        };
                        return (
                          <tr key={parcel.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                            <td className="px-4 py-3 text-sm font-semibold text-[#7b5e27] sm:px-5">{parcel.codigo_tracking}</td>
                            <td className="px-4 py-3 text-sm font-medium text-slate-800">{parcel.destinatarioNombre}</td>
                            <td className="max-w-xs truncate px-4 py-3 text-sm text-slate-600">{parcel.descripcion}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${stateColors[parcel.estado] || "bg-slate-100 text-slate-700"}`}>
                                {parcel.estado === "recojo_domicilio" ? "Recojo" : parcel.estado.replaceAll("_", " ")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 2: VENTA DE PASAJES (WIZARD) */}
        {/* ================================================================== */}
        {activeTab === "venta" && (
          <div className="ticket-print-context space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white">
                  Venta de Pasajes
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Control de aforo riguroso para vehículos tipo Camioneta/Auto (Máx. 4 pasajeros).
                </p>
              </div>
            </div>

            {/* Steps indicator */}
            <div className="flex items-center justify-between max-w-md mx-auto bg-slate-900/80 border border-white/10 rounded-2xl p-2 shadow-premium backdrop-blur-md">
              <div
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider ${
                  wizardStep === 1
                    ? "bg-linear-to-r from-emerald-600 to-green-600 text-white shadow-md"
                    : "text-slate-400"
                }`}
              >
                <span className="h-4 w-4 rounded-full bg-black/30 flex items-center justify-center text-[10px]">
                  1
                </span>
                <span>Viaje</span>
              </div>
              <div className="h-0.5 w-6 bg-white/10"></div>
              <div
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider ${
                  wizardStep === 2
                    ? "bg-linear-to-r from-emerald-600 to-green-600 text-white shadow-md"
                    : "text-slate-400"
                }`}
              >
                <span className="h-4 w-4 rounded-full bg-black/30 flex items-center justify-center text-[10px]">
                  2
                </span>
                <span>Pasajero</span>
              </div>
              <div className="h-0.5 w-6 bg-white/10"></div>
              <div
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider ${
                  wizardStep === 3
                    ? "bg-linear-to-r from-emerald-600 to-green-600 text-white shadow-md"
                    : "text-slate-400"
                }`}
              >
                <span className="h-4 w-4 rounded-full bg-black/30 flex items-center justify-center text-[10px]">
                  3
                </span>
                <span>Boleto</span>
              </div>
            </div>

            {/* WIZARD STEP 1: SELECT TRIP */}
            {wizardStep === 1 && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-premium backdrop-blur-md space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor="booking-route" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                      Ruta Disponible
                    </label>
                    <select
                      id="booking-route"
                      value={selectedRouteId}
                      onChange={(e) => setSelectedRouteId(e.target.value)}
                      className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">Seleccione una ruta...</option>
                      {db.rutas.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.origen} ⇄ {r.destino} (S/ {r.precio.toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="booking-date" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                      Fecha de Salida
                    </label>
                    <input
                      id="booking-date"
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-white/10">
                  <h4 className="font-extrabold text-sm text-white">
                    Salidas Programadas
                  </h4>
                  <div className="grid grid-cols-1 gap-3">
                    {db.viajes.filter(
                      (v) =>
                        v.id_ruta === selectedRouteId &&
                        v.fecha === selectedDate &&
                        isTripOpenForBooking(v, new Date(tripAvailabilityNow)),
                    ).length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-white/10 rounded-2xl text-slate-500 text-xs font-medium">
                        {selectedRouteId
                          ? "No hay salidas disponibles para esa fecha. Los viajes cuya hora de salida ya pasó no aceptan nuevos pasajes."
                          : "Selecciona una ruta y fecha para visualizar los viajes disponibles."}
                      </div>
                    ) : (
                      db.viajes
                        .filter(
                          (v) =>
                            v.id_ruta === selectedRouteId &&
                            v.fecha === selectedDate &&
                            isTripOpenForBooking(v, new Date(tripAvailabilityNow)),
                        )
                        .map((trip) => {
                          const veh = db.vehiculos.find(
                            (ve) => ve.id === trip.id_vehiculo,
                          );
                          const cond = db.conductores.find(
                            (c) => c.id === trip.id_conductor,
                          );
                          const bookedCount = getBookedSeats(trip.id).length;
                          const available = 4 - bookedCount;

                          return (
                            <button
                              key={trip.id}
                              type="button"
                              onClick={() => {
                                if (!isTripOpenForBooking(trip)) {
                                  notify({
                                    type: "warning",
                                    title: "La hora de salida ya pasó",
                                    message: "Selecciona otra salida para emitir el pasaje.",
                                  });
                                  return;
                                }
                                if (available > 0) {
                                  setSelectedTrip(trip);
                                  setPassengerPrecio(trip.precio);
                                  setSelectedSeat(0);
                                  setWizardStep(2);
                                } else {
                                  notify({
                                    type: "warning",
                                    title: "Viaje sin disponibilidad",
                                    message: "Los cuatro asientos ya se encuentran ocupados.",
                                  });
                                }
                              }}
                              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 cursor-pointer hover:border-emerald-500/50 hover:bg-slate-850/50 transition-all shadow-md group text-left"
                            >
                              <div className="flex items-center gap-3">
                                <span className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                  <CalendarDays className="h-5 w-5" />
                                </span>
                                <div>
                                  <h5 className="font-extrabold text-sm text-white font-mono group-hover:text-emerald-300 transition-colors">
                                    Salida: {trip.hora}
                                  </h5>
                                  <p className="text-xs text-slate-400 font-medium mt-0.5">
                                    Conductor: {cond?.nombres} | {veh?.marca} {veh?.modelo} ({veh?.placa})
                                  </p>
                                </div>
                              </div>
                              <div className="text-right flex items-center gap-4 sm:flex-col sm:items-end">
                                <strong className="text-emerald-400 text-lg font-black font-mono">
                                  S/ {trip.precio.toFixed(2)}
                                </strong>
                                <span
                                  className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-lg border ${
                                    available > 0
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                      : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                  }`}
                                >
                                  {available > 0
                                    ? `${available} Asientos Libres`
                                    : "Completo"}
                                </span>
                              </div>
                            </button>
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
                {/* Visual Seat Selection Layout */}
                <div className="md:col-span-5 rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-premium backdrop-blur-md flex flex-col justify-between items-center text-center">
                  <div>
                    <h4 className="font-extrabold text-sm text-white">
                      Distribución de Asientos
                    </h4>
                    <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                      Camioneta Hilux 4x4 / Auto (Capacidad: 4 pasajeros)
                    </p>
                  </div>

                  <div className="w-60 border border-white/15 rounded-3xl p-5 bg-slate-950/80 space-y-4 my-6 shadow-inner">
                    <div className="bg-slate-800 text-slate-400 text-[10px] font-black py-1 rounded-t-xl tracking-widest uppercase border-b border-white/5">
                      PARABRISAS DELANTERO
                    </div>

                    {/* Front row */}
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex-1 aspect-square bg-slate-900 border border-white/5 text-slate-500 rounded-xl flex flex-col items-center justify-center text-[9px] font-bold cursor-not-allowed">
                        Volante
                      </div>
                      <button
                        type="button"
                        disabled={getBookedSeats(selectedTrip.id).includes(1)}
                        aria-pressed={selectedSeat === 1}
                        onClick={() =>
                          !getBookedSeats(selectedTrip.id).includes(1) &&
                          setSelectedSeat(1)
                        }
                        className={`flex-1 aspect-square rounded-xl border flex flex-col items-center justify-center text-[10px] font-black transition-all cursor-pointer ${
                          getBookedSeats(selectedTrip.id).includes(1)
                            ? "bg-rose-500/10 border-rose-500/20 text-rose-400 cursor-not-allowed"
                            : selectedSeat === 1
                              ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300"
                              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                        }`}
                      >
                        Copiloto
                        <span className="font-mono text-xs mt-0.5">A1</span>
                      </button>
                    </div>

                    <div className="h-px border-b border-dashed border-white/10"></div>

                    {/* Back Row */}
                    <div className="flex justify-between items-center gap-2">
                      {[2, 3, 4].map((sNum) => {
                        const isTaken = getBookedSeats(
                          selectedTrip.id,
                        ).includes(sNum);
                        const isSelected = selectedSeat === sNum;
                        return (
                          <button
                            key={sNum}
                            type="button"
                            disabled={isTaken}
                            aria-pressed={isSelected}
                            onClick={() => !isTaken && setSelectedSeat(sNum)}
                            className={`flex-1 aspect-square rounded-xl border flex flex-col items-center justify-center text-[10px] font-black transition-all cursor-pointer ${
                              isTaken
                                ? "bg-rose-500/10 border-rose-500/20 text-rose-400 cursor-not-allowed"
                                : isSelected
                                  ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300"
                                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                            }`}
                          >
                            Asiento
                            <span className="font-mono text-xs mt-0.5">
                              A{sNum}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-4 text-[10px] font-black uppercase text-slate-400 justify-center">
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-md bg-emerald-500/20 border border-emerald-500/40 block" />{" "}
                      Libre
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-md bg-emerald-500 block" />{" "}
                      Elegido
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-md bg-rose-500/20 border border-rose-500/40 block" />{" "}
                      Ocupado
                    </div>
                  </div>
                </div>

                {/* Passenger Form */}
                <div className="md:col-span-7 rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-premium backdrop-blur-md space-y-4">
                  <div className="flex justify-between items-center pb-3 border-b border-white/10">
                    <h4 className="font-extrabold text-sm text-white">
                      Datos del Pasajero
                    </h4>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      Asiento seleccionado:{" "}
                      {selectedSeat > 0 ? `A${selectedSeat}` : "Ninguno"}
                    </span>
                  </div>

                  <form onSubmit={handleBookingSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="passenger-dni" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                        Documento DNI
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="passenger-dni"
                          type="text"
                          maxLength={8}
                          pattern="\d{8}"
                          required
                          value={passengerDni}
                          onChange={(e) => setPassengerDni(e.target.value)}
                          placeholder="8 dígitos"
                          className="grow rounded-xl bg-slate-950/80 border border-white/10 px-3.5 py-2.5 text-sm font-mono text-white focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={searchPassengerDni}
                          disabled={isQueryingReniec}
                          className="rounded-xl bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-300 text-xs font-black uppercase px-4 py-2.5 transition cursor-pointer disabled:opacity-50 flex items-center gap-2"
                        >
                          <Search className="h-4 w-4" />
                          {isQueryingReniec ? "Buscando..." : "Reniec"}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label htmlFor="passenger-first-name" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Nombres
                        </label>
                        <input
                          id="passenger-first-name"
                          type="text"
                          required
                          value={passengerNombres}
                          onChange={(e) => setPassengerNombres(e.target.value)}
                          className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="passenger-last-name" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Apellidos
                        </label>
                        <input
                          id="passenger-last-name"
                          type="text"
                          required
                          value={passengerApellidos}
                          onChange={(e) =>
                            setPassengerApellidos(e.target.value)
                          }
                          className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label htmlFor="passenger-phone" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Teléfono de Contacto
                        </label>
                        <input
                          id="passenger-phone"
                          type="text"
                          value={passengerTelefono}
                          onChange={(e) =>
                            setPassengerTelefono(e.target.value)
                          }
                          placeholder="987 654 321"
                          className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="passenger-price" className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Tarifa del Pasaje (S/)
                        </label>
                        <input
                          id="passenger-price"
                          type="number"
                          step="0.5"
                          value={passengerPrecio}
                          readOnly
                          aria-readonly="true"
                          className="w-full rounded-xl bg-slate-950/80 border border-white/10 px-3.5 py-2.5 text-xs text-white font-mono font-bold focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label htmlFor="ticket-payment-method" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                          Método de pago
                        </label>
                        <select
                          id="ticket-payment-method"
                          required
                          value={ticketPaymentMethod}
                          onChange={(event) => {
                            const method = event.target.value as PaymentMethod;
                            setTicketPaymentMethod(method);
                            if (!paymentMethodRequiresReference(method)) {
                              setTicketPaymentReference("");
                            }
                          }}
                          className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3.5 py-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
                        >
                          {PAYMENT_METHODS.map((method) => (
                            <option key={method} value={method}>
                              {PAYMENT_METHOD_LABELS[method]}
                            </option>
                          ))}
                        </select>
                      </div>
                      {paymentMethodRequiresReference(ticketPaymentMethod) && (
                        <div className="space-y-1.5">
                          <label htmlFor="ticket-payment-reference" className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                            Código de operación
                          </label>
                          <input
                            id="ticket-payment-reference"
                            required
                            minLength={3}
                            maxLength={80}
                            value={ticketPaymentReference}
                            onChange={(event) => setTicketPaymentReference(event.target.value)}
                            placeholder="Ej.: 845217"
                            autoComplete="off"
                            className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3.5 py-2.5 text-xs font-mono text-white outline-none focus:border-emerald-500"
                          />
                        </div>
                      )}
                    </div>

                    {(ticketPaymentMethod === "YAPE" || ticketPaymentMethod === "PLIN") && (
                      <WalletQrPayment
                        key={`${ticketPaymentMethod}:${selectedSeat}:${passengerPrecio}`}
                        method={ticketPaymentMethod}
                        amount={passengerPrecio}
                      />
                    )}

                    <div className="flex gap-3 pt-4 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => setWizardStep(1)}
                        className="rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold px-4 py-3 transition cursor-pointer"
                      >
                        Atrás
                      </button>
                      <button
                        type="submit"
                        disabled={selectedSeat === 0 || pendingAction === "booking"}
                        className="grow rounded-xl bg-linear-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-black text-xs uppercase tracking-widest py-3 shadow-lg transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {pendingAction === "booking"
                          ? "Emitiendo…"
                          : "Emitir Boleto Electrónico"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* WIZARD STEP 3: COMPROBANTE EMITIDO */}
            {wizardStep === 3 && emittedBoleto && (
              <div className="ticket-print-area print-area max-w-xl mx-auto rounded-3xl border border-emerald-500/30 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-md space-y-6 text-center animate-fade-in">
                <div className="h-16 w-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white">
                    ¡Boleto Emitido Exitosamente!
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    Comprobante registrado en la base de datos de la agencia.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 text-left space-y-3 font-mono text-xs">
                  <div className="flex justify-between border-b border-white/10 pb-2">
                    <span className="text-slate-400">Código de Boleto:</span>
                    <span className="font-bold text-emerald-400">
                      {emittedBoleto.codigo}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Pasajero:</span>
                    <span className="text-white font-bold">
                      {emittedBoleto.pasajeroNombres}{" "}
                      {emittedBoleto.pasajeroApellidos}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">DNI:</span>
                    <span className="text-white">
                      {emittedBoleto.pasajeroDni}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Asiento Asignado:</span>
                    <span className="text-emerald-400 font-black">
                      A{emittedBoleto.asiento}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-400">Método de pago:</span>
                    <span className="text-right font-bold text-white">
                      {formatPaymentMethod(emittedBoleto.metodoPago)}
                      {emittedBoleto.referenciaPago && (
                        <small className="block text-slate-400">
                          Op. {emittedBoleto.referenciaPago}
                        </small>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-white/10 pt-2 text-sm">
                    <span className="text-slate-300">Total Pagado:</span>
                    <span className="font-black text-emerald-400">
                      S/ {emittedBoleto.precio.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="no-print flex gap-3">
                  <button
                    onClick={() => window.print()}
                    className="flex-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider py-3 flex items-center justify-center gap-2 cursor-pointer transition"
                  >
                    <Printer className="h-4 w-4" /> Imprimir Boleto
                  </button>
                  <button
                    onClick={resetBookingWizard}
                    className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider py-3 cursor-pointer transition"
                  >
                    Nueva Venta
                  </button>
                </div>
              </div>
            )}

            <TicketSalesHistory
              key={`${currentUser?.id}:${currentUser?.agenciaId}`}
              tickets={db.boletos}
              trips={db.viajes}
              routes={db.rutas}
              canCancel={can(PERMISSIONS.TICKET_CANCEL_REQUEST)}
              canApproveCancellation={can(PERMISSIONS.TICKET_CANCEL_APPROVE)}
              pendingAction={pendingAction}
              onCancel={handleCancelTicket}
            />
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 3: GESTIÓN DE ENCOMIENDAS */}
        {/* ================================================================== */}
        {activeTab === "encomiendas" && (
          <div className="ticket-print-context space-y-6 animate-fade-in">
            <div className="no-print flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white">
                  Gestión de Encomiendas
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Control de envíos, liquidación de fletes y estado de paquetes.
                </p>
              </div>
              <button
                onClick={() => {
                  setEmittedParcel(null);
                  setParcelQrDataUrl("");
                  setIsParcelModalOpen(true);
                }}
                className="rounded-xl bg-linear-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 shadow-lg flex items-center gap-2 cursor-pointer transition"
              >
                <Plus className="h-4 w-4" /> Registrar Encomienda
              </button>
            </div>

            {/* Filter bar */}
            <div className="no-print grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-8 relative">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  aria-label="Buscar encomienda por tracking o DNI"
                  value={searchParcelText}
                  onChange={(e) => setSearchParcelText(e.target.value)}
                  placeholder="Buscar por código de tracking o DNI..."
                  className="w-full rounded-xl bg-slate-900/80 border border-white/10 px-4 py-2.5 pl-10 text-xs text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-4">
                <select
                  aria-label="Filtrar encomiendas por estado"
                  value={filterParcelState}
                  onChange={(e) => setFilterParcelState(e.target.value)}
                  className="w-full rounded-xl bg-slate-900/80 border border-white/10 px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">Todos los estados</option>
                  <option value="registrado">Registrado en Agencia</option>
                  <option value="en_transito">En Tránsito</option>
                  <option value="en_destino">En Destino</option>
                  <option value="entregado">Entregado</option>
                </select>
              </div>
            </div>

            {/* Parcels Table */}
            <div className="no-print rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-premium backdrop-blur-md space-y-4">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-950/40">
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Tracking
                      </th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Remitente
                      </th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Destinatario
                      </th>
                      <th className="py-2.5 px-3 text-center text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Peso / Costo
                      </th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Pago
                      </th>
                      <th className="py-2.5 px-3 text-center text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Estado
                      </th>
                      <th className="py-2.5 px-3 text-center text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Recibo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParcels.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                          No hay encomiendas que coincidan con los filtros.
                        </td>
                      </tr>
                    )}
                    {filteredParcels.map((p) => {
                        const stateColors: Record<string, string> = {
                          registrado:
                            "bg-blue-500/20 text-blue-300 border-blue-500/30",
                          recojo_domicilio:
                            "bg-purple-500/20 text-purple-300 border-purple-500/30",
                          en_transito:
                            "bg-amber-500/20 text-amber-300 border-amber-500/30",
                          en_destino:
                            "bg-blue-500/20 text-blue-300 border-blue-500/30",
                          entregado:
                            "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
                        };
                        return (
                          <tr
                            key={p.id}
                            className="border-b border-white/5 last:border-0 hover:bg-white/5 text-xs text-slate-300 transition-colors"
                          >
                            <td className="py-3 px-3 font-mono font-black text-emerald-400">
                              {p.codigo_tracking}
                            </td>
                            <td className="py-3 px-3 font-semibold text-slate-200">
                              {p.remitenteNombre}
                              <span className="text-[10px] text-slate-500 block">
                                DNI: {p.remitenteDni}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-semibold text-slate-200">
                              {p.destinatarioNombre}
                              <span className="text-[10px] text-slate-500 block">
                                DNI: {p.destinatarioDni}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center font-mono">
                              <span className="text-white font-bold">
                                {p.peso} kg
                              </span>
                              <span className="text-emerald-400 font-black block">
                                S/ {p.costo.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-semibold text-slate-700">
                              {formatPaymentMethod(p.metodoPago)}
                              {p.referenciaPago && (
                                <small className="block font-mono text-[10px] text-slate-500">
                                  Op. {p.referenciaPago}
                                </small>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <span
                                className={`px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border ${
                                  stateColors[p.estado] || "bg-slate-800"
                                }`}
                              >
                                {p.estado.replaceAll("_", " ")}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => void prepareParcelReceipt(p)}
                                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase text-emerald-300 transition hover:bg-emerald-500/20"
                              >
                                Ver recibo
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* MODAL: REGISTRO DE ENCOMIENDA */}
            {isParcelModalOpen &&
              createPortal(
                <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-2 sm:p-4">
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="parcel-dialog-title"
                  aria-describedby="parcel-dialog-description"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setIsParcelModalOpen(false);
                    trapDialogFocus(event);
                  }}
                  className="corporate-dialog flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl animate-fade-in flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
                >
                  <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
                    <div>
                      <h3 id="parcel-dialog-title" className="text-lg font-black text-white">
                        Registrar nueva encomienda
                      </h3>
                      <p id="parcel-dialog-description" className="mt-1 text-xs text-slate-400">
                        Completa los datos del envío para generar la guía y el recibo.
                      </p>
                    </div>
                    <button
                      type="button"
                      autoFocus
                      aria-label="Cerrar registro de encomienda"
                      onClick={() => setIsParcelModalOpen(false)}
                      className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <form onSubmit={handleParcelSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
                      {/* Remitente */}
                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block">
                        1. Datos del Remitente
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label htmlFor="parcel-sender-dni" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            DNI Remitente
                          </label>
                          <div className="flex gap-1.5">
                            <input
                              id="parcel-sender-dni"
                              type="text"
                              required
                              maxLength={8}
                              value={parcelRemDni}
                              onChange={(e) => setParcelRemDni(e.target.value)}
                              className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                            />
                            <button
                              type="button"
                              onClick={() => searchParcelClient("rem")}
                              disabled={isQueryingReniecParcel !== null}
                              aria-label="Consultar DNI del remitente"
                              className="p-2 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 cursor-pointer"
                            >
                              <Search className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor="parcel-sender-name" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Nombre Completo
                          </label>
                          <input
                            id="parcel-sender-name"
                            type="text"
                            required
                            value={parcelRemNombre}
                            onChange={(e) => setParcelRemNombre(e.target.value)}
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label htmlFor="parcel-sender-phone" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Celular del remitente
                          </label>
                          <input
                            id="parcel-sender-phone"
                            type="tel"
                            required
                            inputMode="numeric"
                            pattern="9\d{8}"
                            maxLength={9}
                            value={parcelRemTelf}
                            onChange={(e) =>
                              setParcelRemTelf(e.target.value.replace(/\D/g, ""))
                            }
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                          />
                        </div>
                      </div>
                      </div>

                      {/* Destinatario */}
                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block">
                        2. Datos del Destinatario
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label htmlFor="parcel-recipient-dni" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            DNI Destinatario
                          </label>
                          <div className="flex gap-1.5">
                            <input
                              id="parcel-recipient-dni"
                              type="text"
                              required
                              maxLength={8}
                              value={parcelDestDni}
                              onChange={(e) => setParcelDestDni(e.target.value)}
                              className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                            />
                            <button
                              type="button"
                              onClick={() => searchParcelClient("dest")}
                              disabled={isQueryingReniecParcel !== null}
                              aria-label="Consultar DNI del destinatario"
                              className="p-2 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 cursor-pointer"
                            >
                              <Search className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor="parcel-recipient-name" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Nombre Completo
                          </label>
                          <input
                            id="parcel-recipient-name"
                            type="text"
                            required
                            value={parcelDestNombre}
                            onChange={(e) =>
                              setParcelDestNombre(e.target.value)
                            }
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label htmlFor="parcel-recipient-phone" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Celular del destinatario
                          </label>
                          <input
                            id="parcel-recipient-phone"
                            type="tel"
                            required
                            inputMode="numeric"
                            pattern="9\d{8}"
                            maxLength={9}
                            value={parcelDestTelf}
                            onChange={(e) =>
                              setParcelDestTelf(e.target.value.replace(/\D/g, ""))
                            }
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                          />
                        </div>
                      </div>
                      </div>

                      {/* Viaje y Flete */}
                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 block">
                        3. Detalle del Paquete y Asignación
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-3">
                          <label htmlFor="parcel-trip" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Viaje Asignado
                          </label>
                          <select
                            id="parcel-trip"
                            required
                            value={parcelTripId}
                            onChange={(e) => setParcelTripId(e.target.value)}
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                          >
                            <option value="">Seleccione el viaje de salida...</option>
                            {db.viajes.map((v) => {
                              if (!isTripOpenForBooking(v, new Date(tripAvailabilityNow))) {
                                return null;
                              }
                              const r = db.rutas.find(
                                (rt) => rt.id === v.id_ruta,
                              );
                              return (
                                <option key={v.id} value={v.id}>
                                  {v.id} · {r?.origen} → {r?.destino} ({v.fecha}{" "}
                                  {v.hora})
                                </option>
                              );
                            })}
                          </select>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Solo se muestran viajes programados cuya hora de salida aún no pasó.
                          </p>
                        </div>
                        <div>
                          <label htmlFor="parcel-weight" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Peso (kg)
                          </label>
                          <input
                            id="parcel-weight"
                            type="number"
                            step="0.5"
                            required
                            value={parcelPeso}
                            onChange={(e) => setParcelPeso(e.target.value)}
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white font-mono"
                          />
                        </div>
                        <div>
                          <label htmlFor="parcel-dimension-preset" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Tamaño del paquete
                          </label>
                          <select
                            id="parcel-dimension-preset"
                            required
                            value={parcelDimensionPreset}
                            onChange={(event) => {
                              const preset = event.target.value;
                              setParcelDimensionPreset(preset);
                              setParcelDimensiones(
                                preset === CUSTOM_PARCEL_DIMENSIONS ? "" : preset,
                              );
                            }}
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                          >
                            {PARCEL_DIMENSION_PRESETS.map((preset) => (
                              <option key={preset.value} value={preset.value}>
                                {preset.label}
                              </option>
                            ))}
                            <option value={CUSTOM_PARCEL_DIMENSIONS}>
                              Otra medida · Ingresar dimensiones
                            </option>
                          </select>
                          {parcelDimensionPreset === CUSTOM_PARCEL_DIMENSIONS && (
                            <div className="mt-2">
                              <label htmlFor="parcel-dimensions" className="text-[10px] font-bold uppercase text-slate-400">
                                Dimensiones personalizadas (cm)
                              </label>
                              <input
                                id="parcel-dimensions"
                                type="text"
                                required
                                minLength={3}
                                maxLength={60}
                                value={parcelDimensiones}
                                onChange={(event) => setParcelDimensiones(event.target.value)}
                                placeholder="Largo x ancho x alto"
                                className="mt-1 w-full rounded-xl border border-amber-300 bg-slate-900 px-3 py-2 text-xs font-mono text-white"
                              />
                            </div>
                          )}
                        </div>
                        <div>
                          <label htmlFor="parcel-cost" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Tarifa calculada (S/)
                          </label>
                          <input
                            id="parcel-cost"
                            type="number"
                            step="0.50"
                            readOnly
                            value={parcelCosto}
                            placeholder="Se calcula automáticamente"
                            aria-describedby="parcel-price-breakdown"
                            className="w-full cursor-not-allowed rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-mono font-bold text-slate-900"
                          />
                        </div>
                        <div>
                          <label htmlFor="parcel-value" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Valor declarado (S/)
                          </label>
                          <input
                            id="parcel-value"
                            type="number"
                            min="0"
                            step="0.01"
                            required
                            value={parcelValor}
                            onChange={(e) => setParcelValor(e.target.value)}
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white font-mono"
                          />
                        </div>
                        <div>
                          <label htmlFor="parcel-payment-method" className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                            Método de pago
                          </label>
                          <select
                            id="parcel-payment-method"
                            required
                            value={parcelPaymentMethod}
                            onChange={(event) => {
                              const method = event.target.value as PaymentMethod;
                              setParcelPaymentMethod(method);
                              if (!paymentMethodRequiresReference(method)) {
                                setParcelPaymentReference("");
                              }
                            }}
                            className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                          >
                            {PAYMENT_METHODS.map((method) => (
                              <option key={method} value={method}>
                                {PAYMENT_METHOD_LABELS[method]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div
                          id="parcel-price-breakdown"
                          className="sm:col-span-3 rounded-xl border border-amber-200 bg-amber-50 p-3"
                        >
                          {parcelPriceQuote ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <strong className="text-xs text-slate-800">
                                  Tarifa automática según el paquete y la ruta
                                </strong>
                                <strong className="text-sm text-amber-800">
                                  Total: S/ {parcelPriceQuote.total.toFixed(2)}
                                </strong>
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                                Manejo S/ {parcelPriceQuote.handlingFee.toFixed(2)} · Ruta S/{" "}
                                {parcelPriceQuote.distanceFee.toFixed(2)} · Peso cobrable{" "}
                                {parcelPriceQuote.chargeableWeightKg.toFixed(2)} kg (S/{" "}
                                {parcelPriceQuote.weightFee.toFixed(2)}) · Protección S/{" "}
                                {parcelPriceQuote.protectionFee.toFixed(2)}
                              </p>
                              <p className="mt-1 text-[10px] text-slate-500">
                                Se cobra el mayor entre el peso real ({parcelPriceQuote.actualWeightKg.toFixed(2)} kg) y el volumétrico ({parcelPriceQuote.volumetricWeightKg.toFixed(2)} kg).
                              </p>
                            </>
                          ) : (
                            <p className="text-[11px] text-slate-600">
                              Selecciona el viaje e ingresa peso, dimensiones y valor declarado para calcular el precio.
                            </p>
                          )}
                        </div>
                        {paymentMethodRequiresReference(parcelPaymentMethod) && (
                          <div className="sm:col-span-3">
                            <label htmlFor="parcel-payment-reference" className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                              Código de operación
                            </label>
                            <input
                              id="parcel-payment-reference"
                              required
                              minLength={3}
                              maxLength={80}
                              value={parcelPaymentReference}
                              onChange={(event) => setParcelPaymentReference(event.target.value)}
                              placeholder="Ej.: 845217"
                              autoComplete="off"
                              className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-mono text-white"
                            />
                          </div>
                        )}
                        <div className="sm:col-span-3">
                          {(parcelPaymentMethod === "YAPE" || parcelPaymentMethod === "PLIN") && (
                            <div className="mb-4">
                              <WalletQrPayment
                                key={`${parcelPaymentMethod}:${parcelCosto}`}
                                method={parcelPaymentMethod}
                                amount={parcelCosto}
                              />
                            </div>
                          )}
                          <label htmlFor="parcel-description" className="text-[10px] text-slate-400 font-bold uppercase block mb-1">
                            Descripción del Contenido
                          </label>
                          <input
                            id="parcel-description"
                            type="text"
                            required
                            value={parcelDesc}
                            onChange={(e) => setParcelDesc(e.target.value)}
                            placeholder="Caja con mercadería / Documentos / Ropa"
                            className="w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-xs text-white"
                          />
                        </div>
                      </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-white/10 bg-white/95 px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-6">
                      <button
                        type="button"
                        onClick={() => setIsParcelModalOpen(false)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 sm:w-auto"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={pendingAction === "parcel"}
                        className="w-full rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black uppercase text-white hover:bg-emerald-500 sm:w-auto"
                      >
                        {pendingAction === "parcel"
                          ? "Registrando…"
                          : "Guardar y Generar Guía"}
                      </button>
                    </div>
                  </form>
                </div>
                </div>,
                document.body,
              )}

            {emittedParcel && (
              <section
                aria-label={`Recibo de encomienda ${emittedParcel.codigo_tracking}`}
                className="ticket-print-area print-area mx-auto max-w-2xl space-y-5 rounded-3xl border border-emerald-500/30 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-md sm:p-8"
              >
                <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-400">
                      ECONNVRAE
                    </p>
                    <h3 className="mt-1 text-2xl font-black text-white">
                      Recibo de encomienda
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      {currentUser?.agenciaNombre || "Agencia de transporte"} · {emittedParcel.fechaRegistro}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center">
                    <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">
                      Código de seguimiento
                    </span>
                    <strong className="font-mono text-sm text-emerald-300">
                      {emittedParcel.codigo_tracking}
                    </strong>
                  </div>
                </header>

                <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <span className="text-[9px] font-black uppercase text-slate-500">Remitente</span>
                      <p className="mt-1 font-bold text-white">{emittedParcel.remitenteNombre}</p>
                      <p className="font-mono text-slate-400">DNI {maskDni(emittedParcel.remitenteDni)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
                      <span className="text-[9px] font-black uppercase text-slate-500">Destinatario</span>
                      <p className="mt-1 font-bold text-white">{emittedParcel.destinatarioNombre}</p>
                      <p className="font-mono text-slate-400">DNI {maskDni(emittedParcel.destinatarioDni)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3 sm:col-span-2">
                      <span className="text-[9px] font-black uppercase text-slate-500">Ruta asignada</span>
                      <p className="mt-1 font-bold text-white">
                        {parcelReceiptRoute
                          ? `${parcelReceiptRoute.origen} → ${parcelReceiptRoute.destino}`
                          : emittedParcel.id_viaje}
                      </p>
                      {parcelReceiptTrip && (
                        <p className="text-slate-400">
                          Salida: {parcelReceiptTrip.fecha} · {parcelReceiptTrip.hora}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3 sm:col-span-2">
                      <span className="text-[9px] font-black uppercase text-slate-500">Detalle del envío</span>
                      <p className="mt-1 font-bold text-white">{emittedParcel.descripcion}</p>
                      <p className="text-slate-400">
                        {emittedParcel.peso} kg · {emittedParcel.dimensiones} · Valor declarado S/ {emittedParcel.valor.toFixed(2)}
                      </p>
                      <p className="mt-2 text-base font-black text-emerald-300">
                        Flete pagado: S/ {emittedParcel.costo.toFixed(2)}
                      </p>
                      <p className="mt-1 text-slate-400">
                        Pago: {formatPaymentMethod(emittedParcel.metodoPago)}
                        {emittedParcel.referenciaPago
                          ? ` · Op. ${emittedParcel.referenciaPago}`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <div className="mx-auto w-48 text-center">
                    <div className="flex aspect-square items-center justify-center rounded-2xl bg-white p-2">
                      {parcelQrDataUrl ? (
                        <Image
                          src={parcelQrDataUrl}
                          alt={`QR de seguimiento ${emittedParcel.codigo_tracking}`}
                          width={176}
                          height={176}
                          unoptimized
                        />
                      ) : (
                        <span className="text-xs font-bold text-slate-500">Generando QR…</span>
                      )}
                    </div>
                    <p className="mt-2 text-[10px] font-bold text-slate-400">
                      Escanea para consultar el envío. Se solicitarán los últimos 4 dígitos del DNI del destinatario.
                    </p>
                  </div>
                </div>

                <p className="border-t border-white/10 pt-4 text-center text-[10px] text-slate-500">
                  Constancia operativa de recepción. No sustituye un comprobante electrónico autorizado por SUNAT.
                </p>

                <div className="no-print flex flex-col justify-center gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={!parcelQrDataUrl}
                    onClick={() => window.print()}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black uppercase text-white disabled:opacity-50"
                  >
                    <Printer className="mr-2 inline h-4 w-4" /> Imprimir recibo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmittedParcel(null);
                      setParcelQrDataUrl("");
                    }}
                    className="rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-300"
                  >
                    Cerrar recibo
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 4: PROGRAMACIÓN DE VIAJES */}
        {/* ================================================================== */}
        {activeTab === "viajes" && (
          <div className="space-y-6 animate-fade-in no-print">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white">
                  Programación de Itinerarios
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Control de horarios de salida, asignación de conductores y vehículos.
                </p>
              </div>
              {can(PERMISSIONS.TRIP_MANAGE) && (
                <button
                  onClick={openTripModal}
                  className="rounded-xl bg-linear-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 shadow-lg flex items-center gap-2 cursor-pointer transition"
                >
                  <Plus className="h-4 w-4" /> Programar Nuevo Viaje
                </button>
              )}
            </div>

            {/* Trips Table */}
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-premium backdrop-blur-md space-y-4">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-950/40">
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Código
                      </th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Ruta
                      </th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Fecha / Hora
                      </th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Vehículo / Conductor
                      </th>
                      <th className="py-2.5 px-3 text-center text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Ocupación
                      </th>
                      <th className="py-2.5 px-3 text-center text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Estado
                      </th>
                      <th className="py-2.5 px-3 text-center text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {db.viajes.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                          Aún no hay viajes programados para esta agencia.
                        </td>
                      </tr>
                    )}
                    {db.viajes.map((t) => {
                      const r = db.rutas.find((rt) => rt.id === t.id_ruta);
                      const veh = db.vehiculos.find(
                        (v) => v.id === t.id_vehiculo,
                      );
                      const cond = db.conductores.find(
                        (c) => c.id === t.id_conductor,
                      );
                      const booked = getBookedSeats(t.id).length;
                      return (
                        <tr
                          key={t.id}
                          className="border-b border-white/5 last:border-0 hover:bg-white/5 text-xs text-slate-300 transition-colors"
                        >
                          <td className="py-3 px-3 font-mono font-black text-emerald-400">
                            {t.id}
                          </td>
                          <td className="py-3 px-3 font-semibold text-white">
                            {r?.origen} → {r?.destino}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-300">
                            {t.fecha} {t.hora}
                          </td>
                          <td className="py-3 px-3 text-slate-400">
                            <span className="text-white font-bold block">
                              {veh?.placa} ({veh?.marca})
                            </span>
                            <span>{cond?.nombres}</span>
                          </td>
                          <td className="py-3 px-3 text-center font-bold">
                            <span
                              className={`px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                                booked === 4
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              }`}
                            >
                              {booked} / 4
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-slate-800 text-slate-300 border border-white/10">
                              {t.estado}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            {t.estado === "programado" && can(PERMISSIONS.TRIP_MANAGE) && (
                              <button
                                type="button"
                                onClick={() => void handleCancelTrip(t)}
                                disabled={pendingAction === `cancel-trip-${t.id}`}
                                className="min-h-11 rounded-lg px-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
                              >
                                {pendingAction === `cancel-trip-${t.id}`
                                  ? "Cancelando…"
                                  : "Cancelar"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* MODAL: PROGRAMAR VIAJE */}
            {isTripModalOpen && createPortal(
              <div className="dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 sm:p-4">
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="trip-dialog-title"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setIsTripModalOpen(false);
                    trapDialogFocus(event);
                  }}
                  className="corporate-dialog my-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl animate-fade-in flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
                >
                  <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                        <CalendarDays className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 id="trip-dialog-title" className="text-lg font-black text-slate-900">
                          Programar nuevo viaje
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Define primero la salida y luego asigna los recursos disponibles.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      autoFocus
                      aria-label="Cerrar programación de viaje"
                      onClick={() => setIsTripModalOpen(false)}
                      className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <form onSubmit={handleTripSubmit} className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
                      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black text-white">1</span>
                          <h4 className="text-sm font-black text-slate-900">Ruta y horario</h4>
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="trip-route" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                            Ruta
                          </label>
                          <select
                            id="trip-route"
                            required
                            value={tripRutaId}
                            onChange={(event) => {
                              const routeId = event.target.value;
                              const route = db.rutas.find((item) => item.id === routeId);
                              setTripRutaId(routeId);
                              setTripVehiculoId("");
                              setTripConductorId("");
                              if (route) setTripPrecio(String(route.precio));
                            }}
                            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                          >
                            <option value="">Seleccione una ruta...</option>
                            {db.rutas.map((route) => (
                              <option key={route.id} value={route.id}>
                                {route.origen} → {route.destino} · S/ {route.precio.toFixed(2)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <label htmlFor="trip-date" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                              Fecha
                            </label>
                            <input
                              id="trip-date"
                              type="date"
                              required
                              min={getPeruWallClock(new Date(tripAvailabilityNow)).date}
                              value={tripFecha}
                              onChange={(event) => {
                                setTripFecha(event.target.value);
                                setTripVehiculoId("");
                                setTripConductorId("");
                              }}
                              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label htmlFor="trip-time" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                              Hora de salida
                            </label>
                            <input
                              id="trip-time"
                              type="time"
                              required
                              value={tripHora}
                              onChange={(event) => {
                                setTripHora(event.target.value);
                                setTripVehiculoId("");
                                setTripConductorId("");
                              }}
                              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label htmlFor="trip-price" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                              Tarifa (S/)
                            </label>
                            <input
                              id="trip-price"
                              type="number"
                              min="0"
                              step="0.01"
                              required
                              value={tripPrecio}
                              onChange={(e) => setTripPrecio(e.target.value)}
                              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                            />
                          </div>
                        </div>

                        {selectedTripRoute && (
                          <p className="mt-3 text-xs leading-relaxed text-slate-600">
                            {selectedTripRoute.distancia} · Duración aproximada: {selectedTripRoute.duracion}. La tarifa base de la ruta se completó automáticamente.
                          </p>
                        )}
                      </section>

                      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-[11px] font-black text-white">2</span>
                          <h4 className="text-sm font-black text-slate-900">Vehículo y conductor</h4>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <label htmlFor="trip-vehicle" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                              Vehículo disponible
                            </label>
                            <select
                              id="trip-vehicle"
                              required
                              disabled={!tripRutaId || !tripFecha || !tripHora}
                              value={tripVehiculoId}
                              onChange={(e) => setTripVehiculoId(e.target.value)}
                              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="">Seleccione vehículo...</option>
                              {db.vehiculos.map((vehicle) => {
                                const conflict = tripResourceConflicts.vehicles.get(vehicle.id);
                                return (
                                  <option key={vehicle.id} value={vehicle.id} disabled={Boolean(conflict)}>
                                    {vehicle.placa} · {vehicle.marca} {vehicle.modelo}
                                    {conflict
                                      ? ` — Ocupado hasta ${formatConflictEnd(conflict, tripFecha)}`
                                      : " — Disponible"}
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label htmlFor="trip-driver" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                              Conductor disponible
                            </label>
                            <select
                              id="trip-driver"
                              required
                              disabled={!tripRutaId || !tripFecha || !tripHora}
                              value={tripConductorId}
                              onChange={(e) => setTripConductorId(e.target.value)}
                              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="">Seleccione conductor...</option>
                              {db.conductores.map((driver) => {
                                const conflict = tripResourceConflicts.drivers.get(driver.id);
                                return (
                                  <option key={driver.id} value={driver.id} disabled={Boolean(conflict)}>
                                    {driver.nombres} · Lic. {driver.nroLicencia}
                                    {conflict
                                      ? ` — Ocupado hasta ${formatConflictEnd(conflict, tripFecha)}`
                                      : " — Disponible"}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        </div>

                        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
                            <div>
                              <p className="text-xs font-black">
                                {tripRutaId ? "Disponibilidad para la salida elegida" : "Primero define la ruta y el horario"}
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-blue-800">
                                {tripRutaId
                                  ? `Hay ${availableTripVehicles} vehículo${availableTripVehicles === 1 ? "" : "s"} y ${availableTripDrivers} conductor${availableTripDrivers === 1 ? "" : "es"} disponibles. Si la salida de un viaje ya pasó, sus recursos siguen ocupados hasta finalizarlo; no se liberan por la duración estimada.`
                                  : "Después podrás seleccionar el vehículo y el conductor. Los recursos con viajes pendientes de finalizar no se pueden volver a asignar."}
                              </p>
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>

                    <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                      <button
                        type="button"
                        onClick={() => setIsTripModalOpen(false)}
                        className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={pendingAction === "trip"}
                        className="min-h-11 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingAction === "trip"
                          ? "Guardando…"
                          : "Guardar itinerario"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body,
            )}
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 5: RECOJOS A DOMICILIO */}
        {/* ================================================================== */}
        {activeTab === "recojos" && (
          <div className="space-y-6 animate-fade-in no-print">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white">
                  Solicitudes de Recojo a Domicilio
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Gestión y asignación de choferes para recojo urbano en Ayacucho.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsNewPickupModalOpen(true)}
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black uppercase text-white"
              >
                <Plus className="inline h-4 w-4 mr-2" /> Nueva solicitud
              </button>
            </div>

            {/* Recojos Table */}
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-premium backdrop-blur-md space-y-4">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10 bg-slate-950/40">
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Cliente / Teléfono
                      </th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Dirección
                      </th>
                      <th className="py-2.5 px-3 text-left text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Chofer Asignado
                      </th>
                      <th className="py-2.5 px-3 text-center text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Estado
                      </th>
                      <th className="py-2.5 px-3 text-center text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {db.recojos.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="text-center py-6 text-xs text-slate-500"
                        >
                          No hay solicitudes de recojo registradas.
                        </td>
                      </tr>
                    ) : (
                      db.recojos.map((rec) => (
                        <tr
                          key={rec.id}
                          className="border-b border-white/5 last:border-0 hover:bg-white/5 text-xs text-slate-300 transition-colors"
                        >
                          <td className="py-3 px-3">
                            <span className="text-white font-bold block">
                              {rec.nombre}
                            </span>
                            <span className="text-slate-500 font-mono">
                              {rec.telefono} (DNI: {rec.dni})
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-200">
                            {rec.direccion}
                          </td>
                          <td className="py-3 px-3 text-emerald-400 font-semibold">
                            {rec.asignado || "Sin asignar"}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border ${
                                rec.estado === "pendiente"
                                  ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                                  : rec.estado === "en_camino"
                                    ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                                  : rec.estado === "completado"
                                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                    : "bg-blue-500/20 text-blue-300 border-blue-500/30"
                              }`}
                            >
                              {rec.estado}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex justify-center gap-2">
                              {rec.estado === "pendiente" && can(PERMISSIONS.PICKUP_ASSIGN) && (
                                <button
                                  type="button"
                                  onClick={() => assignDriverToRecojo(rec.id)}
                                  className="rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                                >
                                  Asignar Chofer
                                </button>
                              )}
                              {can(PERMISSIONS.PICKUP_STATUS_MANAGE) &&
                                rec.estado !== "completado" &&
                                rec.estado !== "cancelado" && (
                                  <>
                                    {rec.estado === "asignado" && (
                                      <button
                                        type="button"
                                        disabled={pendingAction === `pickup-${rec.id}`}
                                        onClick={() =>
                                          changeRecojoStatus(rec.id, "en_camino")
                                        }
                                        className="rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                                      >
                                        En camino
                                      </button>
                                    )}
                                    {rec.estado === "en_camino" && (
                                      <button
                                        type="button"
                                        disabled={pendingAction === `pickup-${rec.id}`}
                                        onClick={() =>
                                          changeRecojoStatus(rec.id, "completado")
                                        }
                                        className="rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                                      >
                                        Completar
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      disabled={pendingAction === `pickup-${rec.id}`}
                                      onClick={() =>
                                        changeRecojoStatus(
                                          rec.id,
                                          "cancelado",
                                        )
                                      }
                                      className="rounded-lg bg-rose-600/20 border border-rose-500/40 text-rose-300 hover:bg-rose-600/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                  </>
                                )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {isNewPickupModalOpen && createPortal(
              <div className="dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 sm:p-4 bg-slate-950/80 backdrop-blur-md">
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="pickup-dialog-title"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setIsNewPickupModalOpen(false);
                      lastQueriedPickupDni.current = "";
                    }
                    trapDialogFocus(event);
                  }}
                  className="corporate-dialog my-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-lg animate-fade-in flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
                >
                  <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                        <Home className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 id="pickup-dialog-title" className="text-lg font-black text-slate-900">
                          Nueva solicitud de recojo
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Ingresa el DNI del cliente para autocompletar sus datos con RENIEC.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      autoFocus
                      aria-label="Cerrar"
                      onClick={() => {
                        setIsNewPickupModalOpen(false);
                        lastQueriedPickupDni.current = "";
                      }}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <form onSubmit={submitNewPickup} className="flex flex-1 flex-col overflow-y-auto">
                    <div className="space-y-4 p-5 sm:p-6">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <label htmlFor="pickup-dni" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                            DNI (8 dígitos)
                          </label>
                          <div className="relative">
                            <input
                              id="pickup-dni"
                              required
                              pattern="\d{8}"
                              maxLength={8}
                              placeholder="Ej. 72481920"
                              value={pickupDni}
                              onChange={(e) =>
                                setPickupDni(e.target.value.replace(/\D/g, "").slice(0, 8))
                              }
                              className="min-h-11 w-full rounded-xl border border-slate-300 bg-white pr-9 pl-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                            />
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                              {isQueryingPickupDni ? (
                                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                              ) : (
                                <Search className="h-4 w-4 text-slate-400" />
                              )}
                            </div>
                          </div>
                          {isQueryingPickupDni && (
                            <p className="text-[11px] font-semibold text-emerald-700 animate-pulse">
                              Consultando RENIEC automáticamente...
                            </p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="pickup-phone" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                            Celular
                          </label>
                          <input
                            id="pickup-phone"
                            required
                            pattern="9\d{8}"
                            maxLength={9}
                            placeholder="Ej. 987654321"
                            value={pickupPhone}
                            onChange={(e) =>
                              setPickupPhone(e.target.value.replace(/\D/g, "").slice(0, 9))
                            }
                            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label htmlFor="pickup-name" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                            Nombre completo
                          </label>
                          {isQueryingPickupDni && (
                            <span className="text-[11px] font-semibold text-emerald-600 animate-pulse">
                              Autocompletando...
                            </span>
                          )}
                        </div>
                        <input
                          id="pickup-name"
                          required
                          placeholder="Nombres y apellidos"
                          value={pickupName}
                          onChange={(e) => setPickupName(e.target.value)}
                          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="pickup-date" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                          Fecha de recojo
                        </label>
                        <input
                          id="pickup-date"
                          type="date"
                          required
                          min={getTodayDateString()}
                          value={pickupDate}
                          onChange={(e) => setPickupDate(e.target.value)}
                          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="pickup-address" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                          Dirección de recojo
                        </label>
                        <input
                          id="pickup-address"
                          required
                          minLength={8}
                          placeholder="Ej. Jr. Callao 123, Ayacucho"
                          value={pickupAddress}
                          onChange={(e) => setPickupAddress(e.target.value)}
                          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="pickup-description" className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                          Descripción del envío
                        </label>
                        <textarea
                          id="pickup-description"
                          required
                          minLength={3}
                          maxLength={240}
                          rows={3}
                          placeholder="Ej. Paquete con documentos y encomienda personal"
                          value={pickupDescription}
                          onChange={(e) => setPickupDescription(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                      <button
                        type="button"
                        onClick={() => {
                          setIsNewPickupModalOpen(false);
                          lastQueriedPickupDni.current = "";
                        }}
                        className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={pendingAction === "pickup" || isQueryingPickupDni}
                        className="min-h-11 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black uppercase tracking-wider text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingAction === "pickup" ? "Registrando…" : "Registrar"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body,
            )}

            {/* MODAL: ASIGNAR CHOFER A RECOJO */}
            {isRecojoModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="assign-pickup-dialog-title"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setIsRecojoModalOpen(false);
                    trapDialogFocus(event);
                  }}
                  className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl space-y-4 animate-fade-in"
                >
                  <div className="flex justify-between items-center pb-3 border-b border-white/10">
                    <h3 id="assign-pickup-dialog-title" className="text-base font-black text-white">
                      Asignar Conductor
                    </h3>
                    <button
                      type="button"
                      autoFocus
                      aria-label="Cerrar asignación de conductor"
                      onClick={() => setIsRecojoModalOpen(false)}
                      className="text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <form onSubmit={submitAssignDriver} className="space-y-4">
                    <div className="space-y-1">
                      <label htmlFor="pickup-driver" className="text-xs font-bold text-slate-300 uppercase block">
                        Conductor Responsable
                      </label>
                      <select
                        id="pickup-driver"
                        required
                        value={recojoDriverSelect}
                        onChange={(e) => setRecojoDriverSelect(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2.5 text-xs text-white"
                      >
                        <option value="">Seleccione conductor...</option>
                        {db.conductores.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nombres}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsRecojoModalOpen(false)}
                        className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={pendingAction === "assign-pickup"}
                        className="rounded-xl bg-emerald-600 text-white text-xs font-black uppercase px-4 py-2"
                      >
                        {pendingAction === "assign-pickup" ? "Asignando…" : "Confirmar"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 6: REPORTES FINANCIEROS */}
        {/* ================================================================== */}
        {activeTab === "reportes" && (
          <div className="space-y-6 animate-fade-in">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-white/10 no-print">
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white">
                  Reporte Financiero de Ventas
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Consolidado de ingresos por venta de pasajes y flete de encomiendas.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <button
                  type="button"
                  onClick={exportFinancialReport}
                  className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition hover:bg-emerald-500"
                >
                  <FileSpreadsheet className="h-4 w-4" /> Exportar Excel (CSV)
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition hover:bg-slate-700"
                >
                  <Printer className="h-4 w-4" /> Imprimir / Guardar PDF
                </button>
              </div>
            </div>

            {/* Date filter no-print */}
            <div className="grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-premium no-print sm:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="report-start" className="text-xs font-bold text-slate-300 uppercase block">
                  Fecha Inicial
                </label>
                <input
                  id="report-start"
                  type="date"
                  value={repStart}
                  onChange={(e) => setRepStart(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="report-end" className="text-xs font-bold text-slate-300 uppercase block">
                  Fecha Final
                </label>
                <input
                  id="report-end"
                  type="date"
                  value={repEnd}
                  onChange={(e) => setRepEnd(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="report-route" className="block text-xs font-bold uppercase text-slate-300">
                  Ruta
                </label>
                <select
                  id="report-route"
                  value={repRouteId}
                  onChange={(event) => setRepRouteId(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white"
                >
                  <option value="">Todas las rutas</option>
                  {db.rutas.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.origen} - {route.destino}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!reportRangeIsValid && (
              <div className="no-print rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm font-bold text-amber-100" role="alert">
                La fecha inicial no puede ser posterior a la fecha final.
              </div>
            )}

            {/* Print Area */}
            <div className="print-area space-y-6">
              <header className="hidden border-b border-slate-300 pb-4 text-slate-950 print:block">
                <h1 className="text-2xl font-black">ECONNVRAE · Reporte financiero</h1>
                <p className="mt-1 text-sm">
                  {currentUser?.agenciaNombre || "Consolidado empresarial"} · Del {repStart} al {repEnd}
                </p>
              </header>
              {/* KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-premium text-center">
                  <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">
                    Ingresos Pasajes
                  </span>
                  <strong className="text-2xl sm:text-3xl font-black text-white font-mono">
                    S/ {repData.pasajesTotal.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-emerald-400 font-bold block mt-1">
                    {repData.boletos.length} boletos emitidos
                  </span>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-premium text-center">
                  <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">
                    Ingresos Encomiendas
                  </span>
                  <strong className="text-2xl sm:text-3xl font-black text-white font-mono">
                    S/ {repData.encomiendasTotal.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-amber-400 font-bold block mt-1">
                    {repData.encomiendas.length} encomiendas despachadas
                  </span>
                </div>

                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-premium text-center">
                  <span className="text-[10px] font-black uppercase text-emerald-300 block mb-1">
                    Total Bruto Recaudado
                  </span>
                  <strong className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
                    S/ {repData.total.toFixed(2)}
                  </strong>
                  <span className="text-[10px] text-emerald-300 font-bold block mt-1">
                    Período: {repStart} al {repEnd}
                  </span>
                </div>
              </div>

              {/* Split Tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-premium space-y-3">
                  <h4 className="font-extrabold text-sm text-white border-b border-white/10 pb-2">
                    Detalle de Pasajes
                  </h4>
                  <div className="overflow-x-auto max-h-96">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-[10px] font-black uppercase text-slate-400">
                          <th className="py-2 text-left">Código</th>
                          <th className="py-2 text-left">Pasajero</th>
                          <th className="py-2 text-left">Pago</th>
                          <th className="py-2 text-right">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repData.boletos.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-500">
                              No hay ventas de pasajes en este período.
                            </td>
                          </tr>
                        )}
                        {repData.boletos.map((b) => (
                          <tr
                            key={b.id}
                            className="border-b border-white/5 text-slate-300"
                          >
                            <td className="py-2 font-mono text-emerald-400">
                              {b.codigo}
                            </td>
                            <td className="py-2">
                              {b.pasajeroNombres} {b.pasajeroApellidos}
                            </td>
                            <td className="py-2">
                              {formatPaymentMethod(b.metodoPago)}
                            </td>
                            <td className="py-2 text-right font-mono text-white">
                              S/ {b.precio.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-premium space-y-3">
                  <h4 className="font-extrabold text-sm text-white border-b border-white/10 pb-2">
                    Detalle de Encomiendas
                  </h4>
                  <div className="overflow-x-auto max-h-96">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-[10px] font-black uppercase text-slate-400">
                          <th className="py-2 text-left">Tracking</th>
                          <th className="py-2 text-left">Destinatario</th>
                          <th className="py-2 text-left">Pago</th>
                          <th className="py-2 text-right">Flete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repData.encomiendas.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-500">
                              No hay encomiendas en este período.
                            </td>
                          </tr>
                        )}
                        {repData.encomiendas.map((e) => (
                          <tr
                            key={e.id}
                            className="border-b border-white/5 text-slate-300"
                          >
                            <td className="py-2 font-mono text-amber-400">
                              {e.codigo_tracking}
                            </td>
                            <td className="py-2">{e.destinatarioNombre}</td>
                            <td className="py-2">
                              {formatPaymentMethod(e.metodoPago)}
                            </td>
                            <td className="py-2 text-right font-mono text-white">
                              S/ {e.costo.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 7: FLOTA SATELITAL EN VIVO */}
        {/* ================================================================== */}
        {activeTab === "flota" && (
          <div className="space-y-6 animate-fade-in no-print">
            {fleetError && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{fleetError}</p>}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-white">
                  Seguimiento GPS de Flota
                </h2>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Ubicación reportada por los teléfonos de los conductores en ruta.
                </p>
              </div>
              <span className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-1.5 text-xs font-black uppercase text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>
                  {locations.filter((l) => l.isActive).length} Unidades Activas
                </span>
              </span>
            </div>

            {/* Live Map Card */}
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 overflow-hidden shadow-premium backdrop-blur-md space-y-0">
              <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2 bg-slate-950/60">
                <MapPin className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-black text-white uppercase tracking-wider">
                  Mapa Operativo VRAEM (OpenStreetMap)
                </span>
              </div>
              <LiveMap
                vehicles={locations}
                zoom={10}
                className="w-full h-[480px]"
              />
            </div>
          </div>
        )}

        {activeTab === "administracion" && <AdminWorkspace />}
        </div>
      </main>
    </div>
  );
}

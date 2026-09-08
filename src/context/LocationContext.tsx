"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { VehicleLocation } from "@/lib/domain/types";
import { ageVehicleLocations, canRetryGps } from "@/lib/domain/gps";
import { PERMISSIONS, roleHasPermission } from "@/lib/auth/permissions";
import { useDatabase } from "@/context/DatabaseContext";

export type { VehicleLocation } from "@/lib/domain/types";

interface SimpleCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  capturedAt: string;
}

interface LocationContextType {
  locations: VehicleLocation[];
  fleetError: string | null;
  ownPosition: SimpleCoords | null;
  gpsStatus: "idle" | "requesting" | "active" | "error";
  gpsError: string | null;
  transmissionStatus: "idle" | "sending" | "synced" | "offline" | "error";
  transmissionError: string | null;
  lastSyncedAt: number | null;
  startTracking: (conductorId: string) => void;
  stopTracking: () => void;
}

interface LocationApiPayload {
  locations: VehicleLocation[];
}

interface ActiveLocationPayload {
  conductorId: string;
  isActive: true;
  requestId: string;
  capturedAt: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
}

const POLL_INTERVAL_MS = 5_000;
const MIN_BROADCAST_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MIN_MOVEMENT_METERS = 15;
const LocationContext = createContext<LocationContextType | undefined>(
  undefined,
);

function distanceMeters(from: SimpleCoords, to: SimpleCoords): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const fromLatitude = (from.latitude * Math.PI) / 180;
  const toLatitude = (to.latitude * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function isVehicleLocation(value: unknown): value is VehicleLocation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.conductorId === "string" &&
    typeof item.conductorName === "string" &&
    typeof item.routeLabel === "string" &&
    typeof item.placa === "string" &&
    typeof item.lat === "number" &&
    Number.isFinite(item.lat) &&
    typeof item.lng === "number" &&
    Number.isFinite(item.lng) &&
    typeof item.accuracy === "number" &&
    Number.isFinite(item.accuracy) &&
    (item.speed === null ||
      (typeof item.speed === "number" && Number.isFinite(item.speed))) &&
    (item.heading === null ||
      (typeof item.heading === "number" && Number.isFinite(item.heading))) &&
    typeof item.timestamp === "number" &&
    Number.isFinite(item.timestamp) &&
    typeof item.ageSeconds === "number" &&
    Number.isFinite(item.ageSeconds) &&
    typeof item.isActive === "boolean"
  );
}

async function readLocations(signal?: AbortSignal): Promise<VehicleLocation[]> {
  const response = await fetch("/api/locations", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("LOCATION_READ_FAILED");

  const payload = (await response.json()) as Partial<LocationApiPayload>;
  if (
    !Array.isArray(payload.locations) ||
    !payload.locations.every(isVehicleLocation)
  ) {
    throw new Error("INVALID_LOCATION_RESPONSE");
  }
  return payload.locations;
}

async function sendLocation(
  body:
    | ActiveLocationPayload
    | { conductorId: string; isActive: false },
): Promise<void> {
  const response = await fetch("/api/locations", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    keepalive: true,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      payload?.error?.message || "No se pudo enviar la ubicación al servidor.",
    );
  }
}

export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { currentUser } = useDatabase();
  const [locationSnapshot, setLocationSnapshot] = useState<{
    userId: string | null;
    items: VehicleLocation[];
    receivedAt: number;
  }>({ userId: null, items: [], receivedAt: 0 });
  const [clock, setClock] = useState(0);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [ownPosition, setOwnPosition] = useState<SimpleCoords | null>(null);
  const [gpsStatus, setGpsStatus] =
    useState<LocationContextType["gpsStatus"]>("idle");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [transmissionStatus, setTransmissionStatus] =
    useState<LocationContextType["transmissionStatus"]>("idle");
  const [transmissionError, setTransmissionError] = useState<string | null>(
    null,
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastBroadcastRef = useRef(0);
  const lastBroadcastPositionRef = useRef<SimpleCoords | null>(null);
  const pendingPayloadRef = useRef<ActiveLocationPayload | null>(null);
  const activeMetaRef = useRef<{ conductorId: string } | null>(null);
  const sendingRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const refreshPositionRef = useRef<(() => void) | null>(null);
  const pollingRef = useRef(false);
  const canReadFleet = Boolean(
    currentUser && roleHasPermission(currentUser.rol, PERMISSIONS.FLEET_VIEW),
  );

  const syncLocations = useCallback(async (
    userId: string,
    signal?: AbortSignal,
  ) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const next = await readLocations(signal);
      if (signal?.aborted) return;
      setLocationSnapshot({ userId, items: next, receivedAt: performance.now() });
      setFleetError(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFleetError("No se pudo actualizar la flota. Se muestran las últimas posiciones recibidas, no una señal en vivo.");
    } finally {
      pollingRef.current = false;
    }
  }, []);

  const transmitPayload = useCallback(
    async (payload: ActiveLocationPayload) => {
      if (sendingRef.current || !activeMetaRef.current) return;
      const trackingSession = activeMetaRef.current;
      if (!canRetryGps(payload.capturedAt, Date.now())) {
        if (pendingPayloadRef.current?.requestId === payload.requestId) pendingPayloadRef.current = null;
        setTransmissionStatus("error");
        setTransmissionError("La posición pendiente caducó. Esperando una lectura GPS nueva.");
        return;
      }
      if (!navigator.onLine) {
        pendingPayloadRef.current = payload;
        setTransmissionStatus("offline");
        setTransmissionError(
          "Sin Internet. Se enviará la posición más reciente al recuperar conexión.",
        );
        return;
      }

      setTransmissionStatus("sending");
      setTransmissionError(null);
      sendingRef.current = true;
      try {
        const request = sendLocation(payload);
        inFlightRef.current = request;
        await request;
        if (activeMetaRef.current !== trackingSession) return;
        if (pendingPayloadRef.current?.requestId === payload.requestId) {
          pendingPayloadRef.current = null;
        }
        setTransmissionStatus("synced");
        setLastSyncedAt(Date.now());
        if (currentUser && canReadFleet) void syncLocations(currentUser.id);
      } catch (error) {
        if (activeMetaRef.current !== trackingSession) return;
        if (!pendingPayloadRef.current || Date.parse(pendingPayloadRef.current.capturedAt) <= Date.parse(payload.capturedAt)) pendingPayloadRef.current = payload;
        setTransmissionStatus(navigator.onLine ? "error" : "offline");
        setTransmissionError(
          navigator.onLine
            ? error instanceof Error
              ? `${error.message} Se reintentará automáticamente.`
              : "El GPS está activo, pero la última posición no llegó al servidor. Se reintentará automáticamente."
            : "Sin Internet. Se enviará la posición más reciente al recuperar conexión.",
        );
      } finally {
        sendingRef.current = false;
        inFlightRef.current = null;
      }
    },
    [canReadFleet, currentUser, syncLocations],
  );

  const broadcastPosition = useCallback(
    (coords: SimpleCoords) => {
      const meta = activeMetaRef.current;
      const now = Date.now();
      if (!meta) return;

      if (coords.accuracy > 5_000) {
        setTransmissionStatus("error");
        setTransmissionError(
          "La precisión supera 5 km. Esperando una lectura GPS más confiable.",
        );
        return;
      }

      const elapsed = now - lastBroadcastRef.current;
      const previousPosition = lastBroadcastPositionRef.current;
      const moved = previousPosition
        ? distanceMeters(previousPosition, coords)
        : Number.POSITIVE_INFINITY;
      if (
        elapsed < MIN_BROADCAST_INTERVAL_MS ||
        (moved < MIN_MOVEMENT_METERS && elapsed < HEARTBEAT_INTERVAL_MS)
      ) {
        return;
      }

      const payload: ActiveLocationPayload = {
        conductorId: meta.conductorId,
        isActive: true,
        requestId: crypto.randomUUID(),
        capturedAt: coords.capturedAt,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        speed: coords.speed,
        heading: coords.heading,
      };
      lastBroadcastRef.current = now;
      lastBroadcastPositionRef.current = coords;
      pendingPayloadRef.current = payload;
      void transmitPayload(payload);
    },
    [transmitPayload],
  );

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const meta = activeMetaRef.current;
    activeMetaRef.current = null;
    refreshPositionRef.current = null;
    lastBroadcastRef.current = 0;
    lastBroadcastPositionRef.current = null;
    pendingPayloadRef.current = null;
    if (meta) {
      // Send the stop after an already-dispatched position so responses cannot
      // leave the vehicle active again. A newly started session takes precedence.
      void (inFlightRef.current || Promise.resolve()).catch(() => {}).then(async () => {
        if (activeMetaRef.current?.conductorId === meta.conductorId) return;
        await sendLocation({ conductorId: meta.conductorId, isActive: false });
        if (currentUser && canReadFleet) void syncLocations(currentUser.id);
      }).catch(() => {
        // The central marks old coordinates as stale after 45 seconds.
      });
    }

    setGpsStatus("idle");
    setGpsError(null);
    setOwnPosition(null);
    setTransmissionStatus("idle");
    setTransmissionError(null);
    setLastSyncedAt(null);
  }, [canReadFleet, currentUser, syncLocations]);

  const startTracking = useCallback(
    (conductorId: string) => {
      stopTracking();

      if (!navigator.geolocation) {
        setGpsStatus("error");
        setGpsError("Tu dispositivo no soporta geolocalización.");
        return;
      }

      const trackingSession = { conductorId };
      activeMetaRef.current = trackingSession;
      setGpsStatus("requesting");
      setGpsError(null);
      setTransmissionStatus("idle");
      setTransmissionError(null);
      setLastSyncedAt(null);

      const onPosition = (position: GeolocationPosition) => {
          if (activeMetaRef.current !== trackingSession) return;
          const coords: SimpleCoords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed:
              position.coords.speed === null
                ? null
                : Math.round(Math.max(0, position.coords.speed * 3.6) * 10) /
                  10,
            heading:
              position.coords.heading === null
                ? null
                : position.coords.heading,
            capturedAt: new Date(position.timestamp).toISOString(),
          };
          setOwnPosition(coords);
          setGpsStatus("active");
          setGpsError(null);
          broadcastPosition(coords);
        };
      const onError = (error: GeolocationPositionError) => {
          if (activeMetaRef.current !== trackingSession) return;
          setGpsStatus("error");
          switch (error.code) {
            case error.PERMISSION_DENIED:
              setGpsError(
                "Permiso de ubicación denegado. Habilítalo en el navegador.",
              );
              break;
            case error.POSITION_UNAVAILABLE:
              setGpsError("Señal GPS no disponible.");
              break;
            case error.TIMEOUT:
              setGpsError("Tiempo de espera agotado buscando señal GPS.");
              break;
            default:
              setGpsError("No se pudo obtener la ubicación.");
          }
        };
      const options = { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 };
      watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, options);
      let locating = false;
      refreshPositionRef.current = () => {
        if (locating || activeMetaRef.current !== trackingSession) return;
        locating = true;
        navigator.geolocation.getCurrentPosition(
          (position) => { locating = false; onPosition(position); },
          (error) => { locating = false; onError(error); },
          { ...options, maximumAge: 0 },
        );
      };
    },
    [broadcastPosition, stopTracking],
  );

  useEffect(() => {
    if (!currentUser || !canReadFleet) {
      return;
    }

    const controller = new AbortController();
    const initialSync = window.setTimeout(() => {
      void syncLocations(currentUser.id, controller.signal);
    }, 0);
    const interval = window.setInterval(() => {
      void syncLocations(currentUser.id, controller.signal);
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
    };
  }, [canReadFleet, currentUser, syncLocations]);

  useEffect(() => {
    const retryPendingPosition = () => {
      const pending = pendingPayloadRef.current;
      if (pending && activeMetaRef.current && document.visibilityState === "visible") void transmitPayload(pending);
    };
    const retryTimer = window.setInterval(retryPendingPosition, 15_000);
    const positionTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastBroadcastRef.current >= HEARTBEAT_INTERVAL_MS) refreshPositionRef.current?.();
    }, HEARTBEAT_INTERVAL_MS);
    const ageTimer = window.setInterval(() => setClock(performance.now()), 5_000);
    window.addEventListener("online", retryPendingPosition);
    document.addEventListener("visibilitychange", retryPendingPosition);
    return () => {
      window.removeEventListener("online", retryPendingPosition);
      document.removeEventListener("visibilitychange", retryPendingPosition);
      window.clearInterval(retryTimer);
      window.clearInterval(positionTimer);
      window.clearInterval(ageTimer);
    };
  }, [transmitPayload]);

  useEffect(() => {
    if (!currentUser || currentUser.rol !== "CONDUCTOR") {
      if (activeMetaRef.current) stopTracking();
    }
  }, [currentUser, stopTracking]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      const meta = activeMetaRef.current;
      activeMetaRef.current = null;
      if (meta) {
        void (inFlightRef.current || Promise.resolve()).catch(() => {}).then(() =>
          sendLocation({ conductorId: meta.conductorId, isActive: false }),
        ).catch(() => {});
      }
    };
  }, []);

  return (
    <LocationContext.Provider
      value={{
        locations:
          canReadFleet && currentUser && locationSnapshot.userId === currentUser.id
            ? ageVehicleLocations(locationSnapshot.items, clock - locationSnapshot.receivedAt)
            : [],
        fleetError,
        ownPosition,
        gpsStatus,
        gpsError,
        transmissionStatus,
        transmissionError,
        lastSyncedAt,
        startTracking,
        stopTracking,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};

export function useLocation(): LocationContextType {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error("useLocation must be used inside <LocationProvider>");
  }
  return context;
}

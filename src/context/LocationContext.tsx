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
import { PERMISSIONS, roleHasPermission } from "@/lib/auth/permissions";
import { useDatabase } from "@/context/DatabaseContext";

export type { VehicleLocation } from "@/lib/domain/types";

export interface SimpleCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  capturedAt: string;
}

interface LocationContextType {
  locations: VehicleLocation[];
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
  }>({ userId: null, items: [] });
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
  const canReadFleet = Boolean(
    currentUser && roleHasPermission(currentUser.rol, PERMISSIONS.FLEET_VIEW),
  );

  const syncLocations = useCallback(async (
    userId: string,
    signal?: AbortSignal,
  ) => {
    try {
      const next = await readLocations(signal);
      setLocationSnapshot({ userId, items: next });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }, []);

  const transmitPayload = useCallback(
    async (payload: ActiveLocationPayload) => {
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
      try {
        await sendLocation(payload);
        if (pendingPayloadRef.current?.requestId === payload.requestId) {
          pendingPayloadRef.current = null;
        }
        setTransmissionStatus("synced");
        setLastSyncedAt(Date.now());
        if (currentUser && canReadFleet) void syncLocations(currentUser.id);
      } catch (error) {
        pendingPayloadRef.current = payload;
        setTransmissionStatus(navigator.onLine ? "error" : "offline");
        setTransmissionError(
          navigator.onLine
            ? error instanceof Error
              ? `${error.message} Se reintentará automáticamente.`
              : "El GPS está activo, pero la última posición no llegó al servidor. Se reintentará automáticamente."
            : "Sin Internet. Se enviará la posición más reciente al recuperar conexión.",
        );
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
    lastBroadcastRef.current = 0;
    lastBroadcastPositionRef.current = null;
    pendingPayloadRef.current = null;
    if (meta) {
      void sendLocation({
        conductorId: meta.conductorId,
        isActive: false,
      }).then(() => {
        if (currentUser && canReadFleet) void syncLocations(currentUser.id);
      }).catch(() => {
        // A stale active marker disappears automatically after five minutes.
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

      activeMetaRef.current = { conductorId };
      setGpsStatus("requesting");
      setGpsError(null);
      setTransmissionStatus("idle");
      setTransmissionError(null);
      setLastSyncedAt(null);

      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
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
        },
        (error) => {
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
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
      );
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
      if (pending && activeMetaRef.current) void transmitPayload(pending);
    };
    window.addEventListener("online", retryPendingPosition);
    return () => window.removeEventListener("online", retryPendingPosition);
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
        void sendLocation({ conductorId: meta.conductorId, isActive: false });
      }
    };
  }, []);

  return (
    <LocationContext.Provider
      value={{
        locations:
          canReadFleet && currentUser && locationSnapshot.userId === currentUser.id
            ? locationSnapshot.items
            : [],
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

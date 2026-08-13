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
import { useDatabase } from "@/context/DatabaseContext";

export type { VehicleLocation } from "@/lib/domain/types";

export interface SimpleCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
}

interface LocationContextType {
  locations: VehicleLocation[];
  ownPosition: SimpleCoords | null;
  gpsStatus: "idle" | "requesting" | "active" | "error";
  gpsError: string | null;
  startTracking: (conductorId: string) => void;
  stopTracking: () => void;
}

interface LocationApiPayload {
  locations: VehicleLocation[];
}

const POLL_INTERVAL_MS = 5_000;
const BROADCAST_INTERVAL_MS = 3_000;
const LocationContext = createContext<LocationContextType | undefined>(
  undefined,
);

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
    | {
        conductorId: string;
        isActive: true;
        latitude: number;
        longitude: number;
        accuracy: number;
        speed: number | null;
        heading: number | null;
      }
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
  if (!response.ok) throw new Error("LOCATION_UPDATE_FAILED");
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
  const watchIdRef = useRef<number | null>(null);
  const lastBroadcastRef = useRef(0);
  const activeMetaRef = useRef<{ conductorId: string } | null>(null);

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

  const broadcastPosition = useCallback((coords: SimpleCoords) => {
    const meta = activeMetaRef.current;
    const now = Date.now();
    if (!meta || now - lastBroadcastRef.current < BROADCAST_INTERVAL_MS) return;
    lastBroadcastRef.current = now;

    void sendLocation({
      conductorId: meta.conductorId,
      isActive: true,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      speed: coords.speed,
      heading: coords.heading,
    }).then(() => {
      if (currentUser) void syncLocations(currentUser.id);
    }).catch(() => {
      // The GPS remains active locally; the next reading retries transmission.
    });
  }, [currentUser, syncLocations]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const meta = activeMetaRef.current;
    activeMetaRef.current = null;
    lastBroadcastRef.current = 0;
    if (meta) {
      void sendLocation({
        conductorId: meta.conductorId,
        isActive: false,
      }).then(() => {
        if (currentUser) void syncLocations(currentUser.id);
      }).catch(() => {
        // A stale active marker disappears automatically after five minutes.
      });
    }

    setGpsStatus("idle");
    setGpsError(null);
    setOwnPosition(null);
  }, [currentUser, syncLocations]);

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

      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const coords: SimpleCoords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed:
              position.coords.speed === null
                ? null
                : Math.max(0, position.coords.speed * 3.6),
            heading:
              position.coords.heading === null
                ? null
                : position.coords.heading,
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
    if (!currentUser) return;

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
  }, [currentUser, syncLocations]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      stopTracking();
    };
  }, [stopTracking]);

  return (
    <LocationContext.Provider
      value={{
        locations:
          currentUser && locationSnapshot.userId === currentUser.id
            ? locationSnapshot.items
            : [],
        ownPosition,
        gpsStatus,
        gpsError,
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

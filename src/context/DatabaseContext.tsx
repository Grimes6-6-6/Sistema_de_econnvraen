"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SessionUser } from "@/lib/auth/types";
import { PERMISSIONS, roleHasPermission } from "@/lib/auth/permissions";
import type {
  Boleto,
  DatabaseState,
  DeliveryEvidence,
  Encomienda,
  IncidenciaViaje,
  OfflineAction,
  Recojo,
  Viaje,
} from "@/lib/domain/types";
import { EMPTY_DATABASE_STATE } from "@/lib/domain/types";
import { offlineQueueSchema } from "@/lib/validation/schemas";

export type {
  Boleto,
  Conductor,
  DatabaseState,
  DeliveryEvidence,
  Encomienda,
  IncidenciaViaje,
  OfflineAction,
  Recojo,
  Ruta,
  TrackingHistorico,
  Vehiculo,
  Viaje,
} from "@/lib/domain/types";
export type Usuario = SessionUser;
export type LoginResult =
  | { user: Usuario }
  | {
      nextStep: "MFA_SETUP" | "MFA_VERIFY";
      notice?: string;
    }
  | {
      nextStep: "SMS_VERIFY";
      maskedPhone: string;
      retryAfterSeconds: number;
      authenticatorAvailable: boolean;
    };
export interface MfaSetupDetails {
  qrCodeDataUrl: string;
  manualKey: string;
}

interface DatabaseContextType {
  db: DatabaseState;
  isInitializing: boolean;
  dataError: string | null;
  isOffline: boolean;
  offlineQueue: OfflineAction[];
  toggleOffline: () => void;
  addBoleto: (
    boleto: Omit<
      Boleto,
      "id" | "codigo" | "fechaEmision" | "sunat_estado" | "estado" | "precio"
    >,
  ) => Promise<Boleto | null>;
  anularBoleto: (
    boletoId: string,
    reason: string,
  ) => Promise<"requested" | "cancelled">;
  addEncomienda: (
    encomienda: Omit<
      Encomienda,
      "id" | "codigo_tracking" | "estado" | "fechaRegistro" | "historial"
    >,
  ) => Promise<Encomienda | null>;
  addViaje: (
    viaje: Omit<Viaje, "id" | "estado">,
  ) => Promise<Viaje | null>;
  updateViajeStatus: (
    viajeId: string,
    newState: Extract<Viaje["estado"], "en_curso" | "completado">,
  ) => Promise<Viaje | null>;
  cancelViaje: (viajeId: string, reason: string) => Promise<void>;
  addRecojo: (
    recojo: Omit<Recojo, "id" | "estado" | "asignado">,
  ) => Promise<Recojo | null>;
  assignRecojoDriver: (recojoId: string, driverId: string) => Promise<void>;
  updateRecojoStatus: (
    recojoId: string,
    newState: Extract<
      Recojo["estado"],
      "en_camino" | "completado" | "cancelado"
    >,
  ) => Promise<void>;
  updateParcelStatus: (
    parcelId: string,
    newState: Encomienda["estado"],
    evidence?: DeliveryEvidence | null,
    coordinates?: { latitude: number; longitude: number } | null,
  ) => Promise<void>;
  reportTripIncident: (
    viajeId: string,
    incident: {
      tipo: IncidenciaViaje["tipo"];
      descripcion: string;
      nivel_gravedad?: IncidenciaViaje["nivel_gravedad"];
      latitude?: number | null;
      longitude?: number | null;
    },
  ) => Promise<IncidenciaViaje>;
  getTripIncidents: (viajeId: string) => Promise<IncidenciaViaje[]>;
  updateConductorProfile: (profile: {
    phone?: string;
    email?: string;
    address?: string;
  }) => Promise<{ phone: string; email: string; address: string }>;
  refreshDatabase: () => Promise<void>;
  currentUser: Usuario | null;
  loginUser: (username: string, password: string) => Promise<LoginResult>;
  startMfaSetup: () => Promise<MfaSetupDetails>;
  confirmMfaSetup: (
    code: string,
  ) => Promise<{ user: Usuario; recoveryCodes: string[] }>;
  verifyMfa: (
    code: string,
    method: "sms" | "totp" | "recovery",
  ) => Promise<Usuario>;
  resendSmsCode: () => Promise<{
    maskedPhone: string;
    retryAfterSeconds: number;
  }>;
  logoutUser: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);
const OFFLINE_QUEUE_PREFIX = "econnvrae_offline_queue_v3";

function createRequestId(): string {
  return crypto.randomUUID();
}

function offlineQueueKey(
  userId: string,
  agencyId: string | null,
): string {
  return `${OFFLINE_QUEUE_PREFIX}:${userId}:${agencyId || "global"}`;
}

function readOfflineQueue(
  userId: string,
  agencyId: string | null,
): OfflineAction[] {
  const key = offlineQueueKey(userId, agencyId);
  const storedQueue = localStorage.getItem(key);
  if (!storedQueue) return [];
  if (storedQueue.length > 1_000_000) {
    localStorage.removeItem(key);
    return [];
  }

  try {
    const validated = offlineQueueSchema.safeParse(JSON.parse(storedQueue));
    if (validated.success) return validated.data;
  } catch {
    // Invalid or corrupt queues are discarded below.
  }
  localStorage.removeItem(key);
  return [];
}

function parseErrorMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return "No se pudo completar la operación.";
}

async function apiRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Error(parseErrorMessage(payload));
  return payload as T;
}

function replaceParcel(
  current: DatabaseState,
  parcel: Encomienda,
): DatabaseState {
  return {
    ...current,
    encomiendas: current.encomiendas.map((item) =>
      item.id === parcel.id ? parcel : item,
    ),
  };
}

export const DatabaseProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [db, setDb] = useState<DatabaseState>(EMPTY_DATABASE_STATE);
  const [isInitializing, setIsInitializing] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineAction[]>([]);
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null);
  const syncInProgressRef = useRef(false);
  const lastAutoSyncKeyRef = useRef("");
  const manualOfflineRef = useRef(false);

  const refreshDatabase = useCallback(async () => {
    setDataError(null);
    try {
      const payload = await apiRequest<{ data: DatabaseState }>("/api/data");
      setDb(payload.data);
    } catch (error) {
      setDataError(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la información de la agencia.",
      );
      throw error;
    }
  }, []);

  const establishAuthenticatedUser = useCallback(async (user: Usuario) => {
    setCurrentUser(user);
    setOfflineQueue(readOfflineQueue(user.id, user.agenciaId));
    setDataError(null);
    if (!user.mustChangePassword) {
      await refreshDatabase();
    }
    return user;
  }, [refreshDatabase]);

  const loginUser = async (
    username: string,
    password: string,
  ): Promise<LoginResult> => {
    const payload = await apiRequest<LoginResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if ("user" in payload) {
      await establishAuthenticatedUser(payload.user);
    }
    return payload;
  };

  const startMfaSetup = async (): Promise<MfaSetupDetails> => {
    const payload = await apiRequest<{ setup: MfaSetupDetails }>(
      "/api/auth/mfa/setup",
      { method: "POST", body: JSON.stringify({ action: "start" }) },
    );
    return payload.setup;
  };

  const confirmMfaSetup = async (
    code: string,
  ): Promise<{ user: Usuario; recoveryCodes: string[] }> => {
    const payload = await apiRequest<{
      user: Usuario;
      recoveryCodes: string[];
    }>("/api/auth/mfa/setup", {
      method: "POST",
      body: JSON.stringify({ action: "confirm", code }),
    });
    await establishAuthenticatedUser(payload.user);
    return payload;
  };

  const verifyMfa = async (
    code: string,
    method: "sms" | "totp" | "recovery",
  ): Promise<Usuario> => {
    const payload = await apiRequest<{ user: Usuario }>(
      "/api/auth/mfa/verify",
      { method: "POST", body: JSON.stringify({ code, method }) },
    );
    return establishAuthenticatedUser(payload.user);
  };

  const resendSmsCode = async () =>
    apiRequest<{ maskedPhone: string; retryAfterSeconds: number }>(
      "/api/auth/mfa/sms/resend",
      { method: "POST", body: JSON.stringify({ action: "resend" }) },
    );

  const logoutUser = async () => {
    try {
      await apiRequest<void>("/api/auth/logout", { method: "POST" });
    } finally {
      // Unsynchronized operational events belong to the user and agency. Keep
      // them so an accidental logout does not destroy work recorded offline.
      setCurrentUser(null);
      setDb(EMPTY_DATABASE_STATE);
      setOfflineQueue([]);
      setDataError(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    void apiRequest<{ user: Usuario | null }>("/api/auth/session")
      .then(async (payload) => {
        if (cancelled || !payload.user) return;
        setCurrentUser(payload.user);
        setOfflineQueue(
          readOfflineQueue(payload.user.id, payload.user.agenciaId),
        );
        if (payload.user.mustChangePassword) return;
        const data = await apiRequest<{ data: DatabaseState }>("/api/data");
        if (!cancelled) {
          setDb(data.data);
          setDataError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCurrentUser(null);
          setDb(EMPTY_DATABASE_STATE);
          setDataError(
            error instanceof Error
              ? error.message
              : "No se pudo iniciar la aplicación.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsInitializing(false);
      });

    localStorage.removeItem(OFFLINE_QUEUE_PREFIX);

    return () => {
      cancelled = true;
    };
  }, [refreshDatabase]);

  const hasPermission = (permission: Parameters<typeof roleHasPermission>[1]) =>
    currentUser !== null && roleHasPermission(currentUser.rol, permission);

  const addBoleto = async (
    boletoData: Omit<
      Boleto,
      "id" | "codigo" | "fechaEmision" | "sunat_estado" | "estado" | "precio"
    >,
  ): Promise<Boleto | null> => {
    if (!hasPermission(PERMISSIONS.TICKET_SELL)) {
      throw new Error("No tienes permisos para vender pasajes.");
    }
    const payload = await apiRequest<{ item: Boleto }>("/api/tickets", {
      method: "POST",
      body: JSON.stringify({ ...boletoData, requestId: createRequestId() }),
    });
    await refreshDatabase();
    return payload.item;
  };

  const anularBoleto = async (
    boletoId: string,
    reason: string,
  ): Promise<"requested" | "cancelled"> => {
    if (!hasPermission(PERMISSIONS.TICKET_CANCEL_REQUEST)) {
      throw new Error("No tienes permisos para solicitar anulaciones.");
    }
    const canApprove = hasPermission(PERMISSIONS.TICKET_CANCEL_APPROVE);
    await apiRequest(
      canApprove
        ? `/api/tickets/${encodeURIComponent(boletoId)}/cancel`
        : `/api/tickets/${encodeURIComponent(boletoId)}/cancellation-requests`,
      {
      method: "POST",
      body: JSON.stringify({ reason }),
      },
    );
    if (canApprove) await refreshDatabase();
    return canApprove ? "cancelled" : "requested";
  };

  const addEncomienda = async (
    parcelData: Omit<
      Encomienda,
      "id" | "codigo_tracking" | "estado" | "fechaRegistro" | "historial"
    >,
  ): Promise<Encomienda | null> => {
    if (!hasPermission(PERMISSIONS.PARCEL_CREATE)) {
      throw new Error("No tienes permisos para registrar encomiendas.");
    }
    const payload = await apiRequest<{ item: Encomienda }>("/api/parcels", {
      method: "POST",
      body: JSON.stringify({ ...parcelData, requestId: createRequestId() }),
    });
    await refreshDatabase();
    return payload.item;
  };

  const addViaje = async (
    viajeData: Omit<Viaje, "id" | "estado">,
  ): Promise<Viaje | null> => {
    if (!hasPermission(PERMISSIONS.TRIP_MANAGE)) {
      throw new Error("No tienes permisos para programar viajes.");
    }
    const payload = await apiRequest<{ item: Viaje }>("/api/trips", {
      method: "POST",
      body: JSON.stringify({ ...viajeData, requestId: createRequestId() }),
    });
    await refreshDatabase();
    return payload.item;
  };

  const cancelViaje = async (
    viajeId: string,
    reason: string,
  ): Promise<void> => {
    if (!hasPermission(PERMISSIONS.TRIP_MANAGE)) {
      throw new Error("No tienes permisos para cancelar viajes.");
    }
    await apiRequest(`/api/trips/${encodeURIComponent(viajeId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    await refreshDatabase();
  };

  const updateViajeStatus = async (
    viajeId: string,
    newState: Extract<Viaje["estado"], "en_curso" | "completado">,
  ): Promise<Viaje | null> => {
    if (!hasPermission(PERMISSIONS.TRIP_STATUS_MANAGE)) {
      throw new Error("No tienes permisos para actualizar viajes.");
    }
    const payload = await apiRequest<{ item: Viaje }>(
      `/api/trips/${encodeURIComponent(viajeId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ newState }),
      },
    );
    await refreshDatabase();
    return payload.item;
  };

  const addRecojo = async (
    recojoData: Omit<Recojo, "id" | "estado" | "asignado">,
  ): Promise<Recojo | null> => {
    if (!hasPermission(PERMISSIONS.PICKUP_CREATE)) {
      throw new Error("No tienes permisos para registrar recojos.");
    }
    const payload = await apiRequest<{ item: Recojo }>("/api/pickups", {
      method: "POST",
      body: JSON.stringify({ ...recojoData, requestId: createRequestId() }),
    });
    await refreshDatabase();
    return payload.item;
  };

  const assignRecojoDriver = async (
    recojoId: string,
    driverId: string,
  ): Promise<void> => {
    if (!hasPermission(PERMISSIONS.PICKUP_ASSIGN)) {
      throw new Error("No tienes permisos para asignar recojos.");
    }
    const driver = db.conductores.find((item) => item.id === driverId);
    if (!driver) throw new Error("El conductor seleccionado no existe.");
    await apiRequest(`/api/pickups/${encodeURIComponent(recojoId)}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ driverId: driver.id }),
    });
    await refreshDatabase();
  };

  const updateRecojoStatus = async (
    recojoId: string,
    newState: Extract<
      Recojo["estado"],
      "en_camino" | "completado" | "cancelado"
    >,
  ): Promise<void> => {
    if (!hasPermission(PERMISSIONS.PICKUP_STATUS_MANAGE)) {
      throw new Error("No tienes permisos para actualizar recojos.");
    }
    await apiRequest(`/api/pickups/${encodeURIComponent(recojoId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ newState }),
    });
    await refreshDatabase();
  };

  const syncOfflineQueue = useCallback(async (queue: OfflineAction[]) => {
    if (syncInProgressRef.current || !currentUser) return;
    syncInProgressRef.current = true;
    let processed = 0;
    try {
      for (const action of queue) {
        try {
          const payload = await apiRequest<{ item: Encomienda }>(
            `/api/parcels/${encodeURIComponent(action.parcelId)}/status`,
            {
              method: "PATCH",
              body: JSON.stringify({
                requestId: action.requestId,
                newState: action.newState,
                location: action.location,
                latitude: action.latitude,
                longitude: action.longitude,
                occurredAt: action.timestamp,
                evidence: action.evidence,
              }),
            },
          );
          setDb((current) => replaceParcel(current, payload.item));
          processed += 1;
        } catch {
          // Keep failed actions in the queue for a later synchronization attempt.
          break;
        }
      }
      const remaining = queue.slice(processed);
      setOfflineQueue(remaining);
      if (remaining.length) {
        localStorage.setItem(
          offlineQueueKey(currentUser.id, currentUser.agenciaId),
          JSON.stringify(remaining),
        );
      } else {
        localStorage.removeItem(
          offlineQueueKey(currentUser.id, currentUser.agenciaId),
        );
      }
      await refreshDatabase();
    } finally {
      syncInProgressRef.current = false;
    }
  }, [currentUser, refreshDatabase]);

  useEffect(() => {
    const syncWhenOnline = () => {
      if (manualOfflineRef.current) return;
      setIsOffline(false);
      lastAutoSyncKeyRef.current = "";
      if (offlineQueue.length) void syncOfflineQueue(offlineQueue);
    };
    const markOffline = () => setIsOffline(true);

    window.addEventListener("online", syncWhenOnline);
    window.addEventListener("offline", markOffline);
    const connectionCheck = window.setTimeout(() => {
      if (!navigator.onLine) setIsOffline(true);
      else if (!manualOfflineRef.current) setIsOffline(false);
    }, 0);

    const firstAction = offlineQueue[0];
    if (navigator.onLine && !manualOfflineRef.current && currentUser && firstAction) {
      const attemptKey = `${currentUser.id}:${currentUser.agenciaId}:${firstAction.requestId}`;
      if (lastAutoSyncKeyRef.current !== attemptKey) {
        lastAutoSyncKeyRef.current = attemptKey;
        void syncOfflineQueue(offlineQueue);
      }
    }

    return () => {
      window.clearTimeout(connectionCheck);
      window.removeEventListener("online", syncWhenOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [currentUser, offlineQueue, syncOfflineQueue]);

  const toggleOffline = () => {
    if (!hasPermission(PERMISSIONS.PARCEL_STATUS_MANAGE)) return;
    if (!navigator.onLine) return;
    setIsOffline((current) => {
      const next = !current;
      manualOfflineRef.current = next;
      if (current && !next && offlineQueue.length) {
        void syncOfflineQueue(offlineQueue);
      }
      return next;
    });
  };

  const updateParcelStatus = async (
    parcelId: string,
    newState: Encomienda["estado"],
    evidence: DeliveryEvidence | null = null,
    coordinates: { latitude: number; longitude: number } | null = null,
  ): Promise<void> => {
    if (!hasPermission(PERMISSIONS.PARCEL_STATUS_MANAGE)) {
      throw new Error("No tienes permisos para actualizar encomiendas.");
    }

    const requestId = createRequestId();
    const location = {
      registrado: "Oficina Ayacucho",
      recojo_domicilio: "Recojo a domicilio",
      en_transito: "En ruta Ayacucho - VRAEM",
      en_destino: "Agencia de destino",
      entregado: "Entregado al destinatario",
    }[newState];

    if (isOffline) {
      if (newState === "entregado") {
        throw new Error(
          "La entrega con firma requiere conexión para no guardar datos biométricos en este dispositivo.",
        );
      }
      const action: OfflineAction = {
        requestId,
        parcelId,
        newState,
        timestamp: new Date().toISOString(),
        location,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
        evidence,
      };
      const nextQueue = [...offlineQueue, action];
      const validatedQueue = offlineQueueSchema.safeParse(nextQueue);
      if (!validatedQueue.success || !currentUser) {
        throw new Error(
          "La cola sin conexión alcanzó su límite o contiene datos inválidos.",
        );
      }
      setOfflineQueue(validatedQueue.data);
      localStorage.setItem(
        offlineQueueKey(currentUser.id, currentUser.agenciaId),
        JSON.stringify(validatedQueue.data),
      );
      setDb((current) => {
        const parcel = current.encomiendas.find((item) => item.id === parcelId);
        return parcel
          ? replaceParcel(current, {
              ...parcel,
              estado: newState,
              historial: [
                ...parcel.historial,
                {
                  estado: newState,
                  fecha: `${action.timestamp} (pendiente de sincronización)`,
                  ubicacion: location,
                  responsable: "Conductor (sin conexión)",
                  evidencia: evidence,
                },
              ],
            })
          : current;
      });
      return;
    }

    const payload = await apiRequest<{ item: Encomienda }>(
      `/api/parcels/${encodeURIComponent(parcelId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({
          requestId,
          newState,
          location,
          latitude: coordinates?.latitude,
          longitude: coordinates?.longitude,
          evidence,
        }),
      },
    );
    setDb((current) => replaceParcel(current, payload.item));
  };

  const reportTripIncident = async (
    viajeId: string,
    incident: {
      tipo: IncidenciaViaje["tipo"];
      descripcion: string;
      nivel_gravedad?: IncidenciaViaje["nivel_gravedad"];
      latitude?: number | null;
      longitude?: number | null;
    },
  ): Promise<IncidenciaViaje> => {
    if (!hasPermission(PERMISSIONS.INCIDENT_CREATE)) {
      throw new Error("No tienes permisos para reportar incidencias.");
    }
    const payload = await apiRequest<{ incident: IncidenciaViaje }>(
      `/api/trips/${encodeURIComponent(viajeId)}/incidents`,
      {
        method: "POST",
        body: JSON.stringify(incident),
      },
    );
    return payload.incident;
  };

  const getTripIncidents = async (
    viajeId: string,
  ): Promise<IncidenciaViaje[]> => {
    const payload = await apiRequest<{ incidents: IncidenciaViaje[] }>(
      `/api/trips/${encodeURIComponent(viajeId)}/incidents`,
    );
    return payload.incidents;
  };

  const updateConductorProfile = async (
    profile: { phone?: string; email?: string; address?: string },
  ): Promise<{ phone: string; email: string; address: string }> => {
    const payload = await apiRequest<{
      success: boolean;
      contact: { phone: string; email: string; address: string };
    }>("/api/conductor/profile", {
      method: "PATCH",
      body: JSON.stringify(profile),
    });
    return payload.contact;
  };

  return (
    <DatabaseContext.Provider
      value={{
        db,
        isInitializing,
        dataError,
        isOffline,
        offlineQueue,
        toggleOffline,
        addBoleto,
        anularBoleto,
        addEncomienda,
        addViaje,
        updateViajeStatus,
        cancelViaje,
        addRecojo,
        assignRecojoDriver,
        updateRecojoStatus,
        updateParcelStatus,
        reportTripIncident,
        getTripIncidents,
        updateConductorProfile,
        refreshDatabase,
        currentUser,
        loginUser,
        startMfaSetup,
        confirmMfaSetup,
        verifyMfa,
        resendSmsCode,
        logoutUser,
      }}
    >
      {children}
    </DatabaseContext.Provider>
  );
};

export const useDatabase = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error("useDatabase must be used within a DatabaseProvider");
  }
  return context;
};

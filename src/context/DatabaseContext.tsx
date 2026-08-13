"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/auth/types";
import type {
  Boleto,
  DatabaseState,
  DeliveryEvidence,
  Encomienda,
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
  OfflineAction,
  Recojo,
  Ruta,
  TrackingHistorico,
  Vehiculo,
  Viaje,
} from "@/lib/domain/types";
export type Usuario = SessionUser;

interface DatabaseContextType {
  db: DatabaseState;
  isOffline: boolean;
  offlineQueue: OfflineAction[];
  toggleOffline: () => void;
  addBoleto: (
    boleto: Omit<Boleto, "id" | "codigo" | "fechaEmision" | "sunat_estado" | "estado">,
  ) => Promise<Boleto | null>;
  anularBoleto: (boletoId: string) => Promise<void>;
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
  cancelViaje: (viajeId: string) => Promise<void>;
  addRecojo: (
    recojo: Omit<Recojo, "id" | "estado" | "asignado">,
  ) => Promise<Recojo | null>;
  assignRecojoDriver: (recojoId: string, driverName: string) => Promise<void>;
  updateRecojoStatus: (
    recojoId: string,
    newState: Extract<Recojo["estado"], "completado" | "cancelado">,
  ) => Promise<void>;
  updateParcelStatus: (
    parcelId: string,
    newState: Encomienda["estado"],
    evidence?: DeliveryEvidence | null,
  ) => Promise<void>;
  refreshDatabase: () => Promise<void>;
  currentUser: Usuario | null;
  loginUser: (username: string, password: string) => Promise<Usuario | null>;
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
  const [isOffline, setIsOffline] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineAction[]>([]);
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null);

  const refreshDatabase = useCallback(async () => {
    const payload = await apiRequest<{ data: DatabaseState }>("/api/data");
    setDb(payload.data);
  }, []);

  const loginUser = async (
    username: string,
    password: string,
  ): Promise<Usuario | null> => {
    const payload = await apiRequest<{ user: Usuario }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setCurrentUser(payload.user);
    setOfflineQueue(
      readOfflineQueue(payload.user.id, payload.user.agenciaId),
    );
    await refreshDatabase();
    return payload.user;
  };

  const logoutUser = async () => {
    const queueKey = currentUser
      ? offlineQueueKey(currentUser.id, currentUser.agenciaId)
      : null;
    try {
      await apiRequest<void>("/api/auth/logout", { method: "POST" });
    } finally {
      if (queueKey) localStorage.removeItem(queueKey);
      setCurrentUser(null);
      setDb(EMPTY_DATABASE_STATE);
      setOfflineQueue([]);
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
        const data = await apiRequest<{ data: DatabaseState }>("/api/data");
        if (!cancelled) setDb(data.data);
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentUser(null);
          setDb(EMPTY_DATABASE_STATE);
        }
      });

    localStorage.removeItem(OFFLINE_QUEUE_PREFIX);

    return () => {
      cancelled = true;
    };
  }, [refreshDatabase]);

  const hasRole = (...roles: Usuario["rol"][]) =>
    currentUser !== null &&
    (currentUser.rol === "SUPER_ADMIN" || roles.includes(currentUser.rol));

  const addBoleto = async (
    boletoData: Omit<
      Boleto,
      "id" | "codigo" | "fechaEmision" | "sunat_estado" | "estado"
    >,
  ): Promise<Boleto | null> => {
    if (!hasRole("OPERADOR", "ADMINISTRADOR")) {
      throw new Error("No tienes permisos para vender pasajes.");
    }
    const payload = await apiRequest<{ item: Boleto }>("/api/tickets", {
      method: "POST",
      body: JSON.stringify({ ...boletoData, requestId: createRequestId() }),
    });
    await refreshDatabase();
    return payload.item;
  };

  const anularBoleto = async (boletoId: string): Promise<void> => {
    if (!hasRole("OPERADOR", "ADMINISTRADOR")) {
      throw new Error("No tienes permisos para anular pasajes.");
    }
    await apiRequest(`/api/tickets/${encodeURIComponent(boletoId)}/cancel`, {
      method: "POST",
    });
    await refreshDatabase();
  };

  const addEncomienda = async (
    parcelData: Omit<
      Encomienda,
      "id" | "codigo_tracking" | "estado" | "fechaRegistro" | "historial"
    >,
  ): Promise<Encomienda | null> => {
    if (!hasRole("OPERADOR", "ADMINISTRADOR")) {
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
    if (!hasRole("OPERADOR", "ADMINISTRADOR")) {
      throw new Error("No tienes permisos para programar viajes.");
    }
    const payload = await apiRequest<{ item: Viaje }>("/api/trips", {
      method: "POST",
      body: JSON.stringify({ ...viajeData, requestId: createRequestId() }),
    });
    await refreshDatabase();
    return payload.item;
  };

  const cancelViaje = async (viajeId: string): Promise<void> => {
    if (!hasRole("OPERADOR", "ADMINISTRADOR")) {
      throw new Error("No tienes permisos para cancelar viajes.");
    }
    await apiRequest(`/api/trips/${encodeURIComponent(viajeId)}/cancel`, {
      method: "POST",
    });
    await refreshDatabase();
  };

  const updateViajeStatus = async (
    viajeId: string,
    newState: Extract<Viaje["estado"], "en_curso" | "completado">,
  ): Promise<Viaje | null> => {
    if (!hasRole("CONDUCTOR", "ADMINISTRADOR")) {
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
    if (!hasRole("OPERADOR", "ADMINISTRADOR")) {
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
    driverName: string,
  ): Promise<void> => {
    if (!hasRole("OPERADOR", "ADMINISTRADOR")) {
      throw new Error("No tienes permisos para asignar recojos.");
    }
    const driver = db.conductores.find((item) => item.nombres === driverName);
    if (!driver) throw new Error("El conductor seleccionado no existe.");
    await apiRequest(`/api/pickups/${encodeURIComponent(recojoId)}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ driverId: driver.id }),
    });
    await refreshDatabase();
  };

  const updateRecojoStatus = async (
    recojoId: string,
    newState: Extract<Recojo["estado"], "completado" | "cancelado">,
  ): Promise<void> => {
    if (!hasRole("OPERADOR", "ADMINISTRADOR")) {
      throw new Error("No tienes permisos para actualizar recojos.");
    }
    await apiRequest(`/api/pickups/${encodeURIComponent(recojoId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ newState }),
    });
    await refreshDatabase();
  };

  const syncOfflineQueue = async (queue: OfflineAction[]) => {
    let processed = 0;
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
    if (remaining.length && currentUser) {
      localStorage.setItem(
        offlineQueueKey(currentUser.id, currentUser.agenciaId),
        JSON.stringify(remaining),
      );
    } else if (currentUser) {
      localStorage.removeItem(
        offlineQueueKey(currentUser.id, currentUser.agenciaId),
      );
    }
    await refreshDatabase();
  };

  const toggleOffline = () => {
    if (!hasRole("CONDUCTOR", "ADMINISTRADOR")) return;
    setIsOffline((current) => {
      const next = !current;
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
  ): Promise<void> => {
    if (!hasRole("CONDUCTOR", "ADMINISTRADOR")) {
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
      const action: OfflineAction = {
        requestId,
        parcelId,
        newState,
        timestamp: new Date().toISOString(),
        location,
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
          evidence,
        }),
      },
    );
    setDb((current) => replaceParcel(current, payload.item));
  };

  return (
    <DatabaseContext.Provider
      value={{
        db,
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
        refreshDatabase,
        currentUser,
        loginUser,
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

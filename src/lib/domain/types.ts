export interface Ruta {
  id: string;
  origen: string;
  destino: string;
  distancia: string;
  duracion: string;
  precio: number;
}

export interface Vehiculo {
  id: string;
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  capacidad: number;
  estado: string;
}

export interface Conductor {
  id: string;
  nombres: string;
  nroLicencia: string;
  categoria: string;
  vencimiento: string;
}

export interface Viaje {
  id: string;
  id_ruta: string;
  id_vehiculo: string;
  id_conductor: string;
  fecha: string;
  hora: string;
  estado: "programado" | "en_curso" | "completado" | "cancelado";
  precio: number;
}

export interface Boleto {
  id: string;
  codigo: string;
  id_viaje: string;
  asiento: number;
  pasajeroDni: string;
  pasajeroNombres: string;
  pasajeroApellidos: string;
  pasajeroTelefono: string;
  precio: number;
  fechaEmision: string;
  estado?: "activo" | "anulado";
  sunat_estado: string;
}

export interface DeliveryEvidence {
  signature?: string | null;
  photo?: string;
}

export interface TrackingHistorico {
  estado: string;
  fecha: string;
  ubicacion: string;
  responsable: string;
  evidencia?: DeliveryEvidence | null;
}

export interface Encomienda {
  id: string;
  codigo_tracking: string;
  id_viaje: string;
  remitenteDni: string;
  remitenteNombre: string;
  remitenteTelefono: string;
  destinatarioDni: string;
  destinatarioNombre: string;
  destinatarioTelefono: string;
  peso: number;
  dimensiones: string;
  valor: number;
  costo: number;
  descripcion: string;
  estado:
    | "registrado"
    | "recojo_domicilio"
    | "en_transito"
    | "en_destino"
    | "entregado";
  fechaRegistro: string;
  historial: TrackingHistorico[];
}

export interface Recojo {
  id: string;
  dni: string;
  nombre: string;
  telefono: string;
  fecha: string;
  direccion: string;
  descripcion: string;
  estado:
    | "pendiente"
    | "asignado"
    | "en_camino"
    | "completado"
    | "cancelado";
  asignado: string;
}

export interface VehicleLocation {
  conductorId: string;
  conductorName: string;
  routeLabel: string;
  placa: string;
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
  ageSeconds: number;
  isActive: boolean;
}

export interface DatabaseState {
  rutas: Ruta[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  viajes: Viaje[];
  boletos: Boleto[];
  encomiendas: Encomienda[];
  recojos: Recojo[];
}

export interface OfflineAction {
  requestId: string;
  parcelId: string;
  newState: Encomienda["estado"];
  timestamp: string;
  location: string;
  latitude?: number;
  longitude?: number;
  evidence: DeliveryEvidence | null;
}

interface PublicTrackingEvent {
  estado: Encomienda["estado"];
  fecha: string;
  ubicacion: string;
}

export interface PublicTrackingResult {
  codigo_tracking: string;
  estado: Encomienda["estado"];
  fechaRegistro: string;
  ultimaUbicacion: string;
  ultimaActualizacion: string;
  historial: PublicTrackingEvent[];
}

export interface IncidenciaViaje {
  id: string;
  id_viaje: string;
  id_conductor: string;
  conductor_nombre?: string;
  id_agencia: string;
  agencia_nombre?: string;
  tipo: "MECANICA" | "CLIMA" | "BLOQUEO_VIA" | "ACCIDENTE" | "RETRASO" | "OTRO";
  descripcion: string;
  nivel_gravedad: "LEVE" | "MODERADA" | "GRAVE";
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export const EMPTY_DATABASE_STATE: DatabaseState = {
  rutas: [],
  vehiculos: [],
  conductores: [],
  viajes: [],
  boletos: [],
  encomiendas: [],
  recojos: [],
};

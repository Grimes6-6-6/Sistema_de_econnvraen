export type UserRole =
  | "SUPER_ADMIN"
  | "ADMINISTRADOR"
  | "OPERADOR"
  | "CONDUCTOR";

export interface SessionUser {
  id: string;
  username: string;
  nombres: string;
  apellidos: string;
  rol: UserRole;
  dni: string;
  agenciaId: string | null;
  agenciaNombre: string | null;
}

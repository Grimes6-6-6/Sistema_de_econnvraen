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
  conductorId: string | null;
  agenciaId: string | null;
  agenciaNombre: string | null;
}

export function toClientSessionUser(user: SessionUser): SessionUser {
  return {
    ...user,
    dni: user.dni ? `****${user.dni.slice(-4)}` : "",
  };
}

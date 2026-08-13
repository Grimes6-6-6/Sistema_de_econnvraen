export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function badRequest(
  code: string,
  message: string,
  details?: Record<string, string[]>,
): AppError {
  return new AppError(code, message, 400, details);
}

export function unauthorized(message = "Debes iniciar sesión."): AppError {
  return new AppError("UNAUTHORIZED", message, 401);
}

export function forbidden(message = "No tienes permiso para realizar esta acción."): AppError {
  return new AppError("FORBIDDEN", message, 403);
}

export function notFound(message = "El recurso solicitado no existe."): AppError {
  return new AppError("NOT_FOUND", message, 404);
}

export function conflict(code: string, message: string): AppError {
  return new AppError(code, message, 409);
}

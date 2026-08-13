import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { AppError, badRequest, forbidden } from "@/server/errors";

const MAX_JSON_BYTES = 600_000;

export function assertTrustedMutation(request: Request): void {
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");

  if (origin && host) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw forbidden("Origen de solicitud inválido.");
    }

    if (originHost !== host) {
      throw forbidden("La solicitud no proviene de este sitio.");
    }
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw forbidden("Las solicitudes entre sitios no están permitidas.");
  }
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") {
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      "El contenido debe enviarse como application/json.",
      415,
    );
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_JSON_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", "La solicitud es demasiado grande.", 413);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_JSON_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", "La solicitud es demasiado grande.", 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw badRequest("INVALID_JSON", "El cuerpo JSON no es válido.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Revisa los datos enviados.",
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }

  return parsed.data;
}

export function noStoreJson<T>(body: T, init?: ResponseInit): NextResponse<T> {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function isDatabaseConfigurationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "DATABASE_URL_NOT_CONFIGURED" ||
      error.message === "DATABASE_CA_CERT_REQUIRED" ||
      error.message === "DATABASE_POOL_MAX_INVALID" ||
      error.message === "AUTH_HASH_PEPPER_NOT_CONFIGURED")
  );
}

function getErrorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return noStoreJson(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  if (isDatabaseConfigurationError(error)) {
    return noStoreJson(
      {
        error: {
          code: "SERVICE_NOT_CONFIGURED",
          message: "El servicio de datos todavía no está configurado.",
        },
      },
      { status: 503 },
    );
  }

  const errorCode = getErrorCode(error);
  if (errorCode === "23505") {
    return noStoreJson(
      {
        error: {
          code: "DUPLICATE_RECORD",
          message: "Ya existe un registro con esos datos.",
        },
      },
      { status: 409 },
    );
  }
  if (errorCode === "23503") {
    return noStoreJson(
      {
        error: {
          code: "RELATED_RECORD_CONFLICT",
          message: "La operación depende de un registro que no está disponible.",
        },
      },
      { status: 409 },
    );
  }
  if (errorCode === "23514" || errorCode === "22P02") {
    return noStoreJson(
      {
        error: {
          code: "DATABASE_VALIDATION_ERROR",
          message: "Los datos no cumplen las reglas del sistema.",
        },
      },
      { status: 400 },
    );
  }
  if (
    errorCode === "ECONNREFUSED" ||
    errorCode === "ENOTFOUND" ||
    errorCode === "57P01" ||
    errorCode === "57014"
  ) {
    return noStoreJson(
      {
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "El servicio de datos no está disponible temporalmente.",
        },
      },
      { status: 503 },
    );
  }

  const errorId = randomUUID();
  console.error("Unhandled route error", {
    errorId,
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown error",
  });

  return noStoreJson(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Ocurrió un error interno. Intenta nuevamente.",
        errorId,
      },
    },
    { status: 500 },
  );
}

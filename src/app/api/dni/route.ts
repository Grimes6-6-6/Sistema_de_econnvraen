import { getSessionUser } from "@/lib/auth/session";
import { roleCanAccess } from "@/lib/auth/users";
import { dniLookupSchema } from "@/lib/validation/schemas";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
  parseJsonBody,
} from "@/server/http";
import { getClientAddressHash } from "@/server/security/request";
import { consumeRateLimit } from "@/server/security/rate-limit";

const DNI_RATE_LIMIT = 30;
const DNI_RATE_WINDOW_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8_000;

interface DniResult {
  nombres: string;
  apellidos: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getMockName(dni: string): DniResult {
  const nombres = [
    "Luis Alberto",
    "Carlos Eduardo",
    "Ana María",
    "Rosa Elena",
    "Jorge Luis",
    "José Antonio",
    "Miguel Ángel",
    "Ruth Noemí",
    "Carmen Julia",
    "Víctor Raúl",
  ];
  const apellidos = [
    "Quispe Condori",
    "Flores Mamani",
    "Huamán Mendoza",
    "Gutiérrez Vargas",
    "Sánchez Díaz",
    "Rojas Torres",
    "Castillo Salazar",
    "Chávez Ramos",
    "Espinoza Ortiz",
    "Benítez Medina",
  ];

  let hash = 0;
  for (const digit of dni) {
    hash = digit.charCodeAt(0) + ((hash << 5) - hash);
  }

  return {
    nombres: nombres[Math.abs(hash) % nombres.length],
    apellidos: apellidos[Math.abs(hash + 3) % apellidos.length],
  };
}

async function fetchProviderJson(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`DNI_PROVIDER_HTTP_${response.status}`);
  return response.json();
}

async function queryDniProvider(
  dni: string,
  token: string,
): Promise<DniResult | null> {
  const isPeruApi = token.startsWith("sk_") || token.startsWith("pk_");
  const isApiPeruDev = /^[0-9a-fA-F]{64}$/.test(token);

  if (isApiPeruDev) {
    const payload = await fetchProviderJson("https://api.apiperu.dev/dni", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dni }),
    });
    if (!isRecord(payload) || !isRecord(payload.data)) return null;

    const nombres = readString(payload.data, "nombres");
    const paterno = readString(payload.data, "apellido_paterno");
    const materno = readString(payload.data, "apellido_materno");
    return nombres && paterno && materno
      ? { nombres, apellidos: `${paterno} ${materno}` }
      : null;
  }

  if (isPeruApi) {
    const payload = await fetchProviderJson(
      `https://api.peruapi.com/v1/dni/${dni}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!isRecord(payload) || !isRecord(payload.data)) return null;

    const nombres = readString(payload.data, "nombres");
    const paterno = readString(payload.data, "apellido_paterno");
    const materno = readString(payload.data, "apellido_materno");
    return nombres && paterno && materno
      ? { nombres, apellidos: `${paterno} ${materno}` }
      : null;
  }

  const payload = await fetchProviderJson(
    `https://api.apis.net.pe/v2/reniec/dni?numero=${encodeURIComponent(dni)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Referer: "https://apis.net.pe/consulta-dni-api",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!isRecord(payload)) return null;

  const nombres = readString(payload, "nombres");
  const paterno = readString(payload, "apellidoPaterno");
  const materno = readString(payload, "apellidoMaterno");
  return nombres && paterno && materno
    ? { nombres, apellidos: `${paterno} ${materno}` }
    : null;
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await getSessionUser();
    if (!user) {
      return noStoreJson({ error: { code: "UNAUTHORIZED", message: "No autenticado." } }, { status: 401 });
    }
    if (!roleCanAccess(user.rol, ["OPERADOR", "ADMINISTRADOR"])) {
      return noStoreJson({ error: { code: "FORBIDDEN", message: "No autorizado." } }, { status: 403 });
    }

    const rateLimit = await consumeRateLimit(
      `dni:${user.id}:${getClientAddressHash(request)}`,
      DNI_RATE_LIMIT,
      DNI_RATE_WINDOW_MS,
    );
    if (!rateLimit.allowed) {
      return noStoreJson(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Límite de consultas alcanzado. Intenta nuevamente más tarde.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const { dni } = await parseJsonBody(request, dniLookupSchema);
    const token = process.env.RENIEC_API_TOKEN?.trim().replace(/^Bearer\s+/i, "");
    const allowMockFallback =
      process.env.ALLOW_DNI_MOCK_FALLBACK === "true";

    if (!token || token === "TUPERSONALTOKENAQUI") {
      if (allowMockFallback) {
        return noStoreJson({ success: true, source: "mock", ...getMockName(dni) });
      }
      return noStoreJson(
        {
          error: {
            code: "DNI_PROVIDER_NOT_CONFIGURED",
            message: "El proveedor de DNI no está configurado.",
          },
        },
        { status: 503 },
      );
    }

    try {
      const result = await queryDniProvider(dni, token);
      if (result) {
        return noStoreJson({ success: true, source: "real", ...result });
      }
    } catch (error) {
      console.error("DNI provider request failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    }

    if (allowMockFallback) {
      return noStoreJson({ success: true, source: "fallback", ...getMockName(dni) });
    }

    return noStoreJson(
      {
        error: {
          code: "DNI_PROVIDER_UNAVAILABLE",
          message: "El proveedor de DNI no está disponible temporalmente.",
        },
      },
      { status: 502 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET() {
  return noStoreJson(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Usa POST para consultar un DNI.",
      },
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

import { createHash } from "node:crypto";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import { driverOperationalDocumentSchema } from "@/lib/validation/schemas";
import {
  detectDocumentMime,
  MAX_DOCUMENT_FILE_BYTES,
  sanitizeDocumentFilename,
} from "@/lib/security/document-files";
import {
  getDriverIdentityVerification,
  listDriverOperationalDocuments,
  uploadDriverOperationalDocument,
} from "@/server/admin/documents";
import { AppError, badRequest } from "@/server/errors";
import { assertTrustedMutation, handleRouteError, noStoreJson } from "@/server/http";
import { consumeRateLimit } from "@/server/security/rate-limit";

const MAX_MULTIPART_BYTES = MAX_DOCUMENT_FILE_BYTES + 256 * 1024;
const UPLOAD_LIMIT = 10;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.DRIVER_SELF_MANAGE);
    const [documents, identity] = await Promise.all([
      listDriverOperationalDocuments(user),
      getDriverIdentityVerification(user),
    ]);
    return noStoreJson({ documents, identity });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.DRIVER_SELF_MANAGE);
    const rateLimit = await consumeRateLimit(
      `driver-document-upload:${user.id}`,
      UPLOAD_LIMIT,
      UPLOAD_WINDOW_MS,
    );
    if (!rateLimit.allowed) {
      return noStoreJson(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Alcanzaste el límite de documentos. Intenta nuevamente más tarde.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        "El documento debe enviarse como formulario con archivo.",
        415,
      );
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        "El archivo supera el máximo permitido de 3 MB.",
        413,
      );
    }

    const formData = await request.formData();
    const parsed = driverOperationalDocumentSchema.safeParse({
      documentType: formData.get("documentType"),
      number: formData.get("number"),
      issuedAt: formData.get("issuedAt") || "",
      expiresAt: formData.get("expiresAt"),
      notes: formData.get("notes") || "",
      vehicleId: formData.get("vehicleId") || "",
    });
    if (!parsed.success) {
      throw badRequest(
        "VALIDATION_ERROR",
        "Revisa los datos del documento.",
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    const uploaded = formData.get("file");
    if (!(uploaded instanceof File) || uploaded.size === 0) {
      throw badRequest("DOCUMENT_FILE_REQUIRED", "Selecciona un archivo para adjuntar.");
    }
    if (uploaded.size > MAX_DOCUMENT_FILE_BYTES) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        "El archivo supera el máximo permitido de 3 MB.",
        413,
      );
    }

    const contents = Buffer.from(await uploaded.arrayBuffer());
    const detectedMime = detectDocumentMime(contents);
    if (!detectedMime) {
      throw new AppError(
        "UNSUPPORTED_DOCUMENT_FILE",
        "Solo se permiten documentos PDF, JPG, PNG o WEBP válidos.",
        415,
      );
    }

    const document = await uploadDriverOperationalDocument(user, parsed.data, {
      name: sanitizeDocumentFilename(uploaded.name),
      mimeType: detectedMime,
      size: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
      contents,
    });
    return noStoreJson({ document }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

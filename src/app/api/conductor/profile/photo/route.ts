import { PERMISSIONS } from "@/lib/auth/permissions";
import { requireApiPermission } from "@/lib/auth/authorization";
import {
  deleteDriverProfilePhoto,
  getDriverProfilePhoto,
  saveDriverProfilePhoto,
} from "@/server/data/operations";
import { AppError, badRequest } from "@/server/errors";
import {
  MAX_PROFILE_PHOTO_UPLOAD_BYTES,
  normalizeProfilePhoto,
} from "@/server/profile-photo";
import {
  assertTrustedMutation,
  handleRouteError,
  noStoreJson,
} from "@/server/http";
import { consumeRateLimit } from "@/server/security/rate-limit";

export const runtime = "nodejs";

const MAX_MULTIPART_BYTES = MAX_PROFILE_PHOTO_UPLOAD_BYTES + 256 * 1024;

export async function GET() {
  try {
    const user = await requireApiPermission(PERMISSIONS.DRIVER_SELF_MANAGE);
    const contents = await getDriverProfilePhoto(user);
    return new Response(new Uint8Array(contents), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "image/webp",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.DRIVER_SELF_MANAGE);
    const rateLimit = await consumeRateLimit(
      `driver-profile-photo:${user.id}`,
      12,
      60 * 60 * 1000,
    );
    if (!rateLimit.allowed) {
      return noStoreJson(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Alcanzaste el límite de cambios de foto. Intenta más tarde.",
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
        "La fotografía debe enviarse como formulario con archivo.",
        415,
      );
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        "La fotografía supera el máximo permitido de 5 MB.",
        413,
      );
    }

    const formData = await request.formData();
    const uploaded = formData.get("photo");
    if (!(uploaded instanceof File) || uploaded.size === 0) {
      throw badRequest("PROFILE_PHOTO_REQUIRED", "Selecciona una fotografía.");
    }

    const normalized = await normalizeProfilePhoto(
      Buffer.from(await uploaded.arrayBuffer()),
    );
    const photoUrl = await saveDriverProfilePhoto(user, normalized);
    return noStoreJson({ photoUrl });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedMutation(request);
    const user = await requireApiPermission(PERMISSIONS.DRIVER_SELF_MANAGE);
    await deleteDriverProfilePhoto(user);
    return noStoreJson({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

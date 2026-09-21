import "server-only";

import sharp from "sharp";
import { detectDocumentMime } from "@/lib/security/document-files";
import { AppError, badRequest } from "@/server/errors";

export const MAX_PROFILE_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PROFILE_PHOTO_STORED_BYTES = 1024 * 1024;

export async function normalizeProfilePhoto(contents: Buffer): Promise<Buffer> {
  if (contents.byteLength === 0) {
    throw badRequest("PROFILE_PHOTO_REQUIRED", "Selecciona una fotografía.");
  }
  if (contents.byteLength > MAX_PROFILE_PHOTO_UPLOAD_BYTES) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      "La fotografía supera el máximo permitido de 5 MB.",
      413,
    );
  }

  const detectedMime = detectDocumentMime(contents);
  if (!detectedMime || detectedMime === "application/pdf") {
    throw new AppError(
      "UNSUPPORTED_PROFILE_PHOTO",
      "La fotografía debe ser un archivo JPG, PNG o WEBP válido.",
      415,
    );
  }

  try {
    const normalized = await sharp(contents, {
      failOn: "error",
      limitInputPixels: 20_000_000,
    })
      .rotate()
      .resize(512, 512, {
        fit: "cover",
        position: "attention",
      })
      .webp({ quality: 82, effort: 5 })
      .toBuffer();

    if (normalized.byteLength > MAX_PROFILE_PHOTO_STORED_BYTES) {
      throw new AppError(
        "PROFILE_PHOTO_PROCESSING_FAILED",
        "No se pudo optimizar la fotografía. Prueba con otra imagen.",
        422,
      );
    }
    return normalized;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INVALID_PROFILE_PHOTO",
      "No se pudo leer la fotografía. Prueba con otra imagen.",
      422,
    );
  }
}

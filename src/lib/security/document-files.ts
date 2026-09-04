export const MAX_DOCUMENT_FILE_BYTES = 3 * 1024 * 1024;

export type AllowedDocumentMime =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectDocumentMime(
  bytes: Uint8Array,
): AllowedDocumentMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function sanitizeDocumentFilename(value: string): string {
  const basename = value.split(/[\\/]/).pop() || "documento";
  const sanitized = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim();
  return (sanitized || "documento").slice(0, 180);
}

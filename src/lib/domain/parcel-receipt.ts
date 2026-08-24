const TRACKING_CODE_PATTERN = /^ECV-\d{6}-\d{5}$/;

export function extractParcelTrackingCode(value: string): string | null {
  const normalizedValue = value.trim();
  const directCode = normalizedValue.toUpperCase();
  if (TRACKING_CODE_PATTERN.test(directCode)) {
    return directCode;
  }

  try {
    const url = new URL(normalizedValue);
    if (url.pathname !== "/public") return null;

    const trackingCode = url.searchParams.get("tracking")?.trim().toUpperCase();
    return trackingCode && TRACKING_CODE_PATTERN.test(trackingCode)
      ? trackingCode
      : null;
  } catch {
    return null;
  }
}

export function buildParcelTrackingUrl(origin: string, trackingCode: string): string {
  const normalizedCode = trackingCode.trim().toUpperCase();
  if (!TRACKING_CODE_PATTERN.test(normalizedCode)) {
    throw new Error("INVALID_TRACKING_CODE");
  }

  const url = new URL("/public", origin);
  url.searchParams.set("tracking", normalizedCode);
  return url.toString();
}

export function maskDni(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : "••••";
}

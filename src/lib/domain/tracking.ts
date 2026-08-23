const TRACKING_PATTERN = /^ECV-(\d{6})-(\d{5})$/;

function checksum(payload: string): number {
  return [...payload].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1),
    0,
  ) % 10;
}

function limaDateParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "00";
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function createTrackingCode(parcelId: number, now = new Date()): string {
  if (!Number.isSafeInteger(parcelId) || parcelId <= 0) {
    throw new Error("INVALID_PARCEL_ID");
  }
  const { year, month, day } = limaDateParts(now);
  const datePart = `${year}${month}${day}`;
  const serialPart = String(parcelId % 10_000).padStart(4, "0");
  return `ECV-${datePart}-${serialPart}${checksum(`${datePart}${serialPart}`)}`;
}

export function hasValidTrackingChecksum(value: string): boolean {
  const match = TRACKING_PATTERN.exec(value);
  if (!match) return false;
  const [, datePart, sequence] = match;
  return checksum(`${datePart}${sequence.slice(0, 4)}`) === Number(sequence[4]);
}

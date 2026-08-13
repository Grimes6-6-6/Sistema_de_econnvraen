export type EntityIdPrefix =
  | "A"
  | "R"
  | "V"
  | "C"
  | "T"
  | "B"
  | "E"
  | "P"
  | "U";

export function formatEntityId(
  prefix: EntityIdPrefix,
  value: number,
  minimumDigits = 3,
): string {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("El identificador numérico no es válido.");
  }
  return `${prefix}${String(value).padStart(minimumDigits, "0")}`;
}

export function parseEntityId(
  value: string,
  expectedPrefix: EntityIdPrefix,
): number | null {
  const match = new RegExp(`^${expectedPrefix}(\\d{2,10})$`).exec(value);
  if (!match) return null;

  const numericId = Number(match[1]);
  return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null;
}

import type { Encomienda } from "./types";

const ALLOWED_TRANSITIONS: Record<
  Encomienda["estado"],
  readonly Encomienda["estado"][]
> = {
  registrado: ["recojo_domicilio", "en_transito"],
  recojo_domicilio: ["en_transito"],
  en_transito: ["en_destino"],
  en_destino: ["entregado"],
  entregado: [],
};

export function canAdvanceParcelStatus(
  current: Encomienda["estado"],
  next: Encomienda["estado"],
): boolean {
  return ALLOWED_TRANSITIONS[current].includes(next);
}

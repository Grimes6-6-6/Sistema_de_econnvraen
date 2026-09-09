const VOLUMETRIC_DIVISOR = 5_000;
const HANDLING_FEE = 5;
const DISTANCE_RATE_PER_KM = 0.03;
const WEIGHT_RATE_PER_KG = 2;
const DECLARED_VALUE_RATE = 0.005;
const MINIMUM_PRICE = 10;
const MAX_DIMENSION_CM = 500;

export interface ParcelDimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface ParcelPriceInput {
  distanceKm: number;
  actualWeightKg: number;
  dimensions: string;
  declaredValue: number;
}

export interface ParcelPriceQuote {
  actualWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  handlingFee: number;
  distanceFee: number;
  weightFee: number;
  protectionFee: number;
  total: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundUpToHalfSol(value: number): number {
  return Math.ceil((value - Number.EPSILON) * 2) / 2;
}

export function parseParcelDimensions(value: string): ParcelDimensions | null {
  const match = value
    .trim()
    .replaceAll(",", ".")
    .match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)$/);

  if (!match) return null;

  const [lengthCm, widthCm, heightCm] = match.slice(1).map(Number);
  if (
    [lengthCm, widthCm, heightCm].some(
      (dimension) =>
        !Number.isFinite(dimension) ||
        dimension <= 0 ||
        dimension > MAX_DIMENSION_CM,
    )
  ) {
    return null;
  }

  return { lengthCm, widthCm, heightCm };
}

export function calculateParcelPrice(
  input: ParcelPriceInput,
): ParcelPriceQuote | null {
  const parsedDimensions = parseParcelDimensions(input.dimensions);
  if (
    !parsedDimensions ||
    !Number.isFinite(input.distanceKm) ||
    input.distanceKm <= 0 ||
    !Number.isFinite(input.actualWeightKg) ||
    input.actualWeightKg <= 0 ||
    !Number.isFinite(input.declaredValue) ||
    input.declaredValue < 0
  ) {
    return null;
  }

  const volumetricWeightKg =
    (parsedDimensions.lengthCm *
      parsedDimensions.widthCm *
      parsedDimensions.heightCm) /
    VOLUMETRIC_DIVISOR;
  const chargeableWeightKg = Math.max(
    input.actualWeightKg,
    volumetricWeightKg,
  );
  const distanceFee = input.distanceKm * DISTANCE_RATE_PER_KM;
  const weightFee = chargeableWeightKg * WEIGHT_RATE_PER_KG;
  const protectionFee = input.declaredValue * DECLARED_VALUE_RATE;
  const subtotal =
    HANDLING_FEE + distanceFee + weightFee + protectionFee;

  return {
    actualWeightKg: roundMoney(input.actualWeightKg),
    volumetricWeightKg: roundMoney(volumetricWeightKg),
    chargeableWeightKg: roundMoney(chargeableWeightKg),
    handlingFee: HANDLING_FEE,
    distanceFee: roundMoney(distanceFee),
    weightFee: roundMoney(weightFee),
    protectionFee: roundMoney(protectionFee),
    total: roundUpToHalfSol(Math.max(MINIMUM_PRICE, subtotal)),
  };
}

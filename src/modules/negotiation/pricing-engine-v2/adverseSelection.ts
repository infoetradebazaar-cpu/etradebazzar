// Stage 3, no-op returns 0 for both signals (w(r)'s discount factors collapse to 1)

export interface AdverseSignalInputs {
  visiblePrice: number; // V
  hiddenFloorPrice: number; // F
  clampedCustomerPrice: number; // clampedC = max(C, F)
  t: number; // t(r) = r/R*
}

// Glosten-Milgrom style: opening near-floor early looks "informed", discount their influence
export function computeAdverseSignal(inputs: AdverseSignalInputs, enabled: boolean): number {
  if (!enabled) return 0;
  const { visiblePrice, hiddenFloorPrice, clampedCustomerPrice, t } = inputs;
  const range = visiblePrice - hiddenFloorPrice;
  if (range <= 0) return 0;
  const proximity = (visiblePrice - clampedCustomerPrice) / range;
  return Math.max(0, Math.min(1, proximity - t));
}

export interface PriceImpactInputs {
  visiblePrice: number;
  hiddenFloorPrice: number;
  previousOfferedPrices: number[]; // most recent first
}

// Kyle's-lambda style: how much our own last move revealed, normalized to [F,V]. 0 before round 2.
export function computePriceImpact(inputs: PriceImpactInputs, enabled: boolean): number {
  if (!enabled) return 0;
  const { visiblePrice, hiddenFloorPrice, previousOfferedPrices } = inputs;
  if (previousOfferedPrices.length < 2) return 0;
  const range = visiblePrice - hiddenFloorPrice;
  if (range <= 0) return 0;
  const [last, prev] = previousOfferedPrices;
  return Math.abs(last! - prev!) / range;
}

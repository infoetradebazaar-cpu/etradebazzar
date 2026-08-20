import { computeMomentumState } from "./momentum-gate";

export const MAX_ROUNDS = 3;
export const PREMIUM_STRETCH_PCT = 0.03;

function clampBetween(value: number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.max(lo, Math.min(value, hi));
}

export function interpolateOffer(
  visiblePrice: number,
  hiddenFloor: number,
  round: number,
  customerPrice?: number,
  previousCustomerPrices: (number | undefined)[] = [],
  minImprovement = 0,
): number {

  const rawT = (r: number) => r / MAX_ROUNDS;
  const { effectiveT } = computeMomentumState(
    [...previousCustomerPrices, customerPrice],
    rawT,
    minImprovement,
    MAX_ROUNDS,
  );

  // no separate final-round force-to-floor: effectiveT reaches exactly 1
  // once every round was genuine, which alone reduces this to hiddenFloor below.
  const interpolated = visiblePrice - (visiblePrice - hiddenFloor) * effectiveT;

  if (customerPrice && customerPrice > 0) {
    if (customerPrice >= visiblePrice) {
      const aspiration = customerPrice * (1 + PREMIUM_STRETCH_PCT);
      const premiumOffer = aspiration - (aspiration - customerPrice) * effectiveT;
      return Math.round(clampBetween(premiumOffer, customerPrice, aspiration));
    }

    const clampedCustomer = Math.max(customerPrice, hiddenFloor);
    const blendWeight = effectiveT; // was the raw round fraction now frozen the same way as `interpolated` above
    const blended = interpolated * (1 - blendWeight) + clampedCustomer * blendWeight;
    const result = clampBetween(blended, hiddenFloor, visiblePrice);
    return Math.round(result);
  }

  return Math.round(interpolated);
}

import type { NegotiationOutcome } from "../../src/modules/negotiation/accept-decision";

export class InvariantViolation extends Error {
  constructor(name: string, detail: string, context?: string) {
    super(`[${name}] ${detail}${context ? ` ${context}` : ""}`);
    this.name = "InvariantViolation";
  }
}
const PRICE_ROUNDING_TOLERANCE = 1;

export function assertFloorSafety(finalPrice: number, floor: number, context?: string): void {
  if (finalPrice < floor - PRICE_ROUNDING_TOLERANCE) {
    throw new InvariantViolation("assertFloorSafety", `finalPrice ${finalPrice} < floor ${floor}`, context);
  }
}

export function assertCeilingSafety(finalPrice: number, ceiling: number, context?: string): void {
  if (finalPrice > ceiling + PRICE_ROUNDING_TOLERANCE) {
    throw new InvariantViolation("assertCeilingSafety", `finalPrice ${finalPrice} > ceiling ${ceiling}`, context);
  }
}

const FULL_CONCESSION_EPSILON = 1e-9;

export function assertNoFreeConcession(
  effectiveT: number,
  genuineRoundsCount: number,
  maxRounds: number,
  context?: string,
): void {
  const cap = genuineRoundsCount / maxRounds + FULL_CONCESSION_EPSILON;
  if (effectiveT > cap) {
    throw new InvariantViolation(
      "assertNoFreeConcession",
      `effectiveT ${effectiveT} exceeds cap ${genuineRoundsCount}/${maxRounds} = ${genuineRoundsCount / maxRounds}`,
      context,
    );
  }
}

export function countGenuineRounds(customerPriceHistory: (number | undefined)[], minImprovement: number): number {
  let count = 1; // round 1 always counts
  for (let round = 2; round <= customerPriceHistory.length; round++) {
    const cp = customerPriceHistory[round - 1];
    const prevCp = customerPriceHistory[round - 2];
    const genuine = cp !== undefined && (prevCp === undefined || cp - prevCp >= minImprovement);
    if (genuine) count++;
  }
  return count;
}

export function assertNoSelfUndercut(
  finalPrice: number,
  bestPriorCustomerOffer: number | undefined,
  visible: number,
  context?: string,
): void {
  if (bestPriorCustomerOffer === undefined) return;
  const bound = Math.min(bestPriorCustomerOffer, visible);
  if (finalPrice < bound - PRICE_ROUNDING_TOLERANCE) {
    throw new InvariantViolation(
      "assertNoSelfUndercut",
      `finalPrice ${finalPrice} < min(customer's best prior offer ${bestPriorCustomerOffer}, visible ${visible}) = ${bound}`,
      context,
    );
  }
}

export function assertNoUnrequestedDiscount(
  round1Offer: number,
  visible: number,
  customerOpeningPrice: number,
  context?: string,
): void {
  if (customerOpeningPrice >= visible && round1Offer < visible - PRICE_ROUNDING_TOLERANCE) {
    throw new InvariantViolation(
      "assertNoUnrequestedDiscount",
      `customer opened at/above visible (${customerOpeningPrice} >= ${visible}) but round1 offer ${round1Offer} fell below visible`,
      context,
    );
  }
}

export function assertNoForcedSaleWithoutEngagement(
  evaluation: NegotiationOutcome,
  everMovedForward: boolean,
  finalRoundCustomerPrice: number | undefined,
  floorPrice: number,
  visiblePrice: number,
  context?: string,
): void {
  if (evaluation.outcome !== "accept" || evaluation.decision.acceptCase !== 3) return;
  const isPremiumBid = finalRoundCustomerPrice !== undefined && finalRoundCustomerPrice >= visiblePrice;
  if (!everMovedForward && !isPremiumBid) {
    throw new InvariantViolation("assertNoForcedSaleWithoutEngagement", "Case 3 accepted without everMovedForward", context);
  }
  if (finalRoundCustomerPrice === undefined || finalRoundCustomerPrice < floorPrice) {
    throw new InvariantViolation(
      "assertNoForcedSaleWithoutEngagement",
      `Case 3 accepted with no genuine qualifying counter this round (got ${finalRoundCustomerPrice})`,
      context,
    );
  }
}

export function assertIdempotency(offer1: unknown, offer2: unknown, context?: string): void {
  const a = JSON.stringify(offer1);
  const b = JSON.stringify(offer2);
  if (a !== b) {
    throw new InvariantViolation("assertIdempotency", `same inputs produced different output: ${a} vs ${b}`, context);
  }
}

export function assertSeedUniqueness(offersAcrossDifferentSessions: number[], context?: string): void {
  if (offersAcrossDifferentSessions.length < 2) return;
  const unique = new Set(offersAcrossDifferentSessions);
  if (unique.size === 1) {
    throw new InvariantViolation(
      "assertSeedUniqueness",
      `all offers identical (${offersAcrossDifferentSessions[0]}) across ${offersAcrossDifferentSessions.length} different sessionIds`,
      context,
    );
  }
}

export function assertNoFloorLeakage(apiResponseBody: unknown, floorValue: number, context?: string): void {
  const bad: string[] = [];
  const seen = new Set<unknown>();

  function scan(node: unknown, path: string): void {
    if (node === null || node === undefined) return;
    if (typeof node === "object") {
      if (seen.has(node)) return; // avoid cycles
      seen.add(node);
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes("hiddenfloor") || lowerKey === "floor" || lowerKey === "floorprice") {
          bad.push(`${path}.${key} (forbidden key)`);
        }
        if (typeof value === "number" && value === floorValue) {
          bad.push(`${path}.${key} = ${value} (matches floor value)`);
        }
        scan(value, `${path}.${key}`);
      }
    }
  }

  scan(apiResponseBody, "$");
  if (bad.length > 0) {
    throw new InvariantViolation("assertNoFloorLeakage", `floor leaked at: ${bad.join(", ")}`, context);
  }
}

export function assertRegressionResistance(
  fittedFloorEstimate: number,
  trueFloor: number,
  tolerance: number,
  context?: string,
): void {
  const diff = Math.abs(fittedFloorEstimate - trueFloor);
  if (diff <= tolerance) {
    throw new InvariantViolation(
      "assertRegressionResistance",
      `naive linear fit recovered the floor within tolerance: |${fittedFloorEstimate} - ${trueFloor}| = ${diff} <= ${tolerance}`,
      context,
    );
  }
}

export function makeRng(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

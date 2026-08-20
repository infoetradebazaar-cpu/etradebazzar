import { describe, test, expect } from "bun:test";
import { computeOfferV2 } from "../../src/modules/negotiation/pricing-engine-v2/engine";
import { interpolateOffer, PREMIUM_STRETCH_PCT } from "../../src/modules/negotiation/legacy-linear-formula";
import { decideAcceptOutcome } from "../../src/modules/negotiation/accept-decision";
import { computeMomentumState } from "../../src/modules/negotiation/momentum-gate";
import {
  DEFAULT_ENGINE_CONSTANTS,
  DEFAULT_GAMMA_CONFIG,
  NEUTRAL_SIGNALS,
  STAGE_0_CONFIG,
  type SellerGammaConfig,
  type EngineSignals,
} from "../../src/modules/negotiation/pricing-engine-v2/types";
import {
  assertFloorSafety,
  assertCeilingSafety,
  assertNoFreeConcession,
  assertNoSelfUndercut,
  assertNoForcedSaleWithoutEngagement,
  assertNoUnrequestedDiscount,
  assertIdempotency,
  assertSeedUniqueness,
  assertNoFloorLeakage,
  assertRegressionResistance,
  countGenuineRounds,
  makeRng,
} from "./negotiation-invariants";

const ITERATIONS = 1000;
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

interface EvalResult {
  offeredPrice: number;
  effectiveT: number;
  everMovedForward: boolean;
  genuineRoundsCount: number;
}

function evalV2(params: {
  sessionId: string;
  visible: number;
  floor: number;
  round: number;
  customerPrice: number | undefined;
  previousCustomerPrices: (number | undefined)[];
  maxRounds: number;
  sellerConfig?: SellerGammaConfig;
  signals?: EngineSignals;
}): EvalResult {
  const sellerConfig = params.sellerConfig ?? DEFAULT_GAMMA_CONFIG;
  const signals = params.signals ?? NEUTRAL_SIGNALS;
  const result = computeOfferV2(
    {
      sessionId: params.sessionId,
      skuId: "prop-sku",
      createdAt: CREATED_AT,
      visiblePrice: params.visible,
      hiddenFloorPrice: params.floor,
      round: params.round,
      customerPrice: params.customerPrice,
      previousOfferedPrices: [],
      previousCustomerPrices: params.previousCustomerPrices,
    },
    sellerConfig,
    STAGE_0_CONFIG,
    signals,
    params.maxRounds,
    DEFAULT_ENGINE_CONSTANTS,
  );
  const minImprovement = Math.max(
    DEFAULT_ENGINE_CONSTANTS.minImprovementFloorRupees,
    sellerConfig.minImprovementPct * (params.visible - params.floor),
  );
  const genuineRoundsCount = countGenuineRounds([...params.previousCustomerPrices, params.customerPrice], minImprovement);
  return {
    offeredPrice: result.offeredPrice,
    effectiveT: result.effectiveT,
    everMovedForward: result.everMovedForward,
    genuineRoundsCount,
  };
}

function evalV1(params: {
  visible: number;
  floor: number;
  round: number;
  customerPrice: number | undefined;
  previousCustomerPrices: (number | undefined)[];
  maxRounds: number;
  minImprovementPct?: number;
}): EvalResult {
  const minImprovementPct = params.minImprovementPct ?? DEFAULT_GAMMA_CONFIG.minImprovementPct;
  const minImprovement = Math.max(
    DEFAULT_ENGINE_CONSTANTS.minImprovementFloorRupees,
    minImprovementPct * (params.visible - params.floor),
  );
  const offeredPrice = interpolateOffer(
    params.visible,
    params.floor,
    params.round,
    params.customerPrice,
    params.previousCustomerPrices,
    minImprovement,
  );
  const { effectiveT, everMovedForward } = computeMomentumState(
    [...params.previousCustomerPrices, params.customerPrice],
    (r) => r / params.maxRounds,
    minImprovement,
    params.maxRounds,
  );
  const genuineRoundsCount = countGenuineRounds([...params.previousCustomerPrices, params.customerPrice], minImprovement);
  return { offeredPrice, effectiveT, everMovedForward, genuineRoundsCount };
}

function bestPrior(previousCustomerPrices: (number | undefined)[]): number | undefined {
  const defined = previousCustomerPrices.filter((p): p is number => p !== undefined);
  return defined.length ? Math.max(...defined) : undefined;
}

function checkCase(
  formula: "v1" | "v2",
  visible: number,
  floor: number,
  round: number,
  maxRounds: number,
  history: (number | undefined)[], // cp(1)..cp(round), last = this round
  label: string,
  sellerConfig?: SellerGammaConfig,
  signals?: EngineSignals,
) {
  const previousCustomerPrices = history.slice(0, -1);
  const customerPrice = history[history.length - 1];
  const sessionId = `prop-${formula}-${label}`;

  const evaluated =
    formula === "v2"
      ? evalV2({ sessionId, visible, floor, round, customerPrice, previousCustomerPrices, maxRounds, sellerConfig, signals })
      : evalV1({ visible, floor, round, customerPrice, previousCustomerPrices, maxRounds, minImprovementPct: sellerConfig?.minImprovementPct });

  const context = `${label} formula=${formula} V=${visible} F=${floor} round=${round}/${maxRounds} history=${JSON.stringify(history)}`;

  const ceiling =
    customerPrice !== undefined ? Math.max(visible, customerPrice * (1 + PREMIUM_STRETCH_PCT)) : visible;

  assertFloorSafety(evaluated.offeredPrice, floor, context);
  assertCeilingSafety(evaluated.offeredPrice, ceiling, context);
  assertNoFreeConcession(evaluated.effectiveT, evaluated.genuineRoundsCount, maxRounds, context);

  const priorBest = bestPrior(previousCustomerPrices);
  const evaluation = decideAcceptOutcome({
    action: "REJECT",
    customerPrice,
    currentOfferedPrice: evaluated.offeredPrice,
    visiblePrice: visible,
    floorPrice: floor,
    round,
    maxRounds,
    tolerancePct: sellerConfig?.tolerancePct ?? DEFAULT_GAMMA_CONFIG.tolerancePct,
    earlyExitMinRound: sellerConfig?.earlyExitMinRound ?? DEFAULT_GAMMA_CONFIG.earlyExitMinRound,
    everMovedForward: evaluated.everMovedForward,
    bestPriorCustomerOffer: priorBest,
  });

  if (evaluation.outcome === "accept") {
    assertNoSelfUndercut(evaluation.decision.finalPrice, priorBest, visible, context);
    assertFloorSafety(evaluation.decision.finalPrice, floor, context);
    assertCeilingSafety(evaluation.decision.finalPrice, Math.max(ceiling, evaluated.offeredPrice), context);
  }
  assertNoForcedSaleWithoutEngagement(evaluation, evaluated.everMovedForward, customerPrice, floor, visible, context);

  return { evaluated, evaluation };
}

function rupee(x: number): number {
  return Math.round(x);
}

function randomWalkHistory(rng: () => number, floor: number, visible: number, maxRounds: number): (number | undefined)[] {
  const history: (number | undefined)[] = [];
  let price = floor + rng() * (visible - floor);
  for (let i = 0; i < maxRounds; i++) {
    if (rng() < 0.1) {
      history.push(undefined);
    } else {
      price = Math.max(floor - 50, Math.min(visible + 50, price + (rng() - 0.5) * (visible - floor) * 0.4));
      history.push(rupee(price));
    }
  }
  return history;
}

function lateSingleMoveHistory(rng: () => number, floor: number, visible: number, maxRounds: number): (number | undefined)[] {
  const stagnant = rupee(floor + rng() * (visible - floor) * 0.3);
  const history: (number | undefined)[] = Array(maxRounds - 1).fill(stagnant);
  const moveSize = 5 + rng() * 200; // randomized magnitude, including near-threshold small moves
  history.push(rupee(stagnant + moveSize));
  return history;
}

function earlyBurstThenStallHistory(rng: () => number, floor: number, visible: number, maxRounds: number): (number | undefined)[] {
  const history: (number | undefined)[] = [];
  let price = floor + rng() * (visible - floor) * 0.2;
  const burstRounds = Math.min(2, maxRounds);
  for (let i = 0; i < burstRounds; i++) {
    price += 50 + rng() * 150;
    history.push(rupee(price));
  }
  for (let i = burstRounds; i < maxRounds; i++) {
    // stall or regress
    price += rng() < 0.5 ? 0 : -(rng() * 50);
    history.push(rupee(price));
  }
  return history;
}

describe("property: random walk customer sequences", () => {
  test(`${ITERATIONS} iterations, v1 and v2, all applicable invariants`, () => {
    const rng = makeRng(1001);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const maxRounds = 3;
      const history = randomWalkHistory(rng, floor, visible, maxRounds);
      for (const formula of ["v1", "v2"] as const) {
        checkCase(formula, visible, floor, maxRounds, maxRounds, history, `randomwalk-${i}`);
      }
    }
  });
});

describe("property: late single move after stagnation (generalized exploit class)", () => {
  test(`${ITERATIONS} iterations, v1 and v2 no single late move ever produces a full-concession outcome`, () => {
    const rng = makeRng(2002);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const maxRounds = 3;
      const history = lateSingleMoveHistory(rng, floor, visible, maxRounds);
      for (const formula of ["v1", "v2"] as const) {
        const { evaluated } = checkCase(formula, visible, floor, maxRounds, maxRounds, history, `latemove-${i}`);
        expect(evaluated.genuineRoundsCount).toBeLessThanOrEqual(2);
        if (evaluated.genuineRoundsCount < maxRounds) {
          expect(evaluated.everMovedForward).toBe(false);
        }
      }
    }
  });
});

describe("property: early burst then stall/regress", () => {
  test(`${ITERATIONS} iterations, v1 and v2`, () => {
    const rng = makeRng(3003);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const maxRounds = 3;
      const history = earlyBurstThenStallHistory(rng, floor, visible, maxRounds);
      for (const formula of ["v1", "v2"] as const) {
        checkCase(formula, visible, floor, maxRounds, maxRounds, history, `burststall-${i}`);
      }
    }
  });
});

describe("property: customer opens strictly above visible price", () => {
  test(`${ITERATIONS} iterations safety invariants (floor/ceiling/momentum/self-undercut) still hold for both formulas`, () => {
    const rng = makeRng(4004);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const opening = rupee(visible * (1.001 + rng() * 0.5));
      checkCase("v2", visible, floor, 1, 3, [opening], `above-${i}`);
      checkCase("v1", visible, floor, 1, 3, [opening], `above-${i}`);
    }
  });

  test("v1 tests ABOVE the customer's bid in round 1 (never flat-capped at visible, never below what they offered)", () => {
    const visible = 1500;
    const floor = 1300;
    for (const customerPrice of [1501, 1600, 2000, 5000]) {
      const v1Evaluated = evalV1({ visible, floor, round: 1, customerPrice, previousCustomerPrices: [], maxRounds: 3 });
      expect(() =>
        assertNoUnrequestedDiscount(v1Evaluated.offeredPrice, visible, customerPrice, `v1 @ customerPrice=${customerPrice}`),
      ).not.toThrow();
      // Never below what they offered, and bounded by the aspiration ceiling.
      expect(v1Evaluated.offeredPrice).toBeGreaterThanOrEqual(customerPrice);
      expect(v1Evaluated.offeredPrice).toBeLessThanOrEqual(customerPrice * (1 + PREMIUM_STRETCH_PCT));
    }
  });

  test("FIXED: v2 never discounts round1's offer below visible for ANY above-visible bid, including ones only slightly above (~0-2%) — the premium-zone clamp floor is now visible itself, not F", () => {
    const visible = 1500;
    const floor = 1300;
    for (const customerPrice of [1501, 1515, 1530]) {
      const v2Evaluated = evalV2({ sessionId: `gap-v2-${customerPrice}`, visible, floor, round: 1, customerPrice, previousCustomerPrices: [], maxRounds: 3 });
      expect(() =>
        assertNoUnrequestedDiscount(v2Evaluated.offeredPrice, visible, customerPrice, `v2 @ customerPrice=${customerPrice}`),
      ).not.toThrow();
      expect(v2Evaluated.offeredPrice).toBeGreaterThanOrEqual(visible);
    }
  });

  test("FIXED (both v1 and v2): customer opens at EXACTLY visible price -> offer never falls below visible, and still tests slightly above it (same premium branch, no special case at the boundary)", () => {
    const visible = 1500;
    const floor = 1300;
    const v1Evaluated = evalV1({ visible, floor, round: 1, customerPrice: visible, previousCustomerPrices: [], maxRounds: 3 });
    expect(() => assertNoUnrequestedDiscount(v1Evaluated.offeredPrice, visible, visible, "v1")).not.toThrow();
    expect(v1Evaluated.offeredPrice).toBeGreaterThanOrEqual(visible);
    expect(v1Evaluated.offeredPrice).toBeLessThanOrEqual(visible * (1 + PREMIUM_STRETCH_PCT));

    const v2Evaluated = evalV2({ sessionId: "boundary-at-visible", visible, floor, round: 1, customerPrice: visible, previousCustomerPrices: [], maxRounds: 3 });
    expect(() => assertNoUnrequestedDiscount(v2Evaluated.offeredPrice, visible, visible, "v2")).not.toThrow();
    expect(v2Evaluated.offeredPrice).toBeGreaterThanOrEqual(visible);
    expect(v2Evaluated.offeredPrice).toBeLessThanOrEqual(visible * (1 + PREMIUM_STRETCH_PCT));
  });
});

describe("property: seller tests ABOVE a premium bid instead of flat-capping at visible or handing back a number below what the customer offered", () => {
  // Exact reproduction case from this fix's report: visible=39900, customerPrice=43691.
  // aspiration = customerPrice * (1 + PREMIUM_STRETCH_PCT) = 43691 * 1.03 = 45001.73.
  const visible = 39900;
  const floor = 38703;
  const customerPrice = 43691;
  const aspiration = customerPrice * (1 + PREMIUM_STRETCH_PCT);

  test("round 1: offer TESTS ABOVE the customer's own bid (never below it), staying under the aspiration ceiling", () => {
    const offer = interpolateOffer(visible, floor, 1, customerPrice, [], 0);
    expect(offer).toBeGreaterThan(customerPrice); // never a number below what they already offered
    expect(offer).toBeLessThan(aspiration);
    expect(offer).toBe(44565); // aspiration - (aspiration-customerPrice)*effectiveT(1), effectiveT(1)=1/3
  });

  test("customer holds the same high bid across rounds (minImprovement=0, so a flat repeat still counts as genuine): the counter CONCEDES DOWN toward their bid each round, landing exactly on it at the final genuine round — never below", () => {
    const prices: number[] = [];
    let previousCustomerPrices: (number | undefined)[] = [];
    for (let round = 1; round <= 3; round++) {
      const offer = interpolateOffer(visible, floor, round, customerPrice, previousCustomerPrices, 0);
      prices.push(offer);
      previousCustomerPrices = [...previousCustomerPrices, customerPrice];
    }
    expect(prices).toEqual([44565, 44128, 43691]);
    expect(prices[1]).toBeLessThan(prices[0]); // conceding down from the aspiration test
    expect(prices[2]).toBeLessThan(prices[1]);
    expect(prices[2]).toBe(customerPrice); // final genuine round settles exactly on their bid, never below
  });

  test("customer backs off their high bid after round 1: momentum gate freezes the concession at round 1's progress (round 2 does NOT get the further concession genuine progress would earn), then resumes once they hold steady again — same freeze/resume shape as the discount side", () => {
    const sequence = [43691, 41000, 41000];
    const prices: number[] = [];
    let previousCustomerPrices: (number | undefined)[] = [];
    for (let round = 1; round <= 3; round++) {
      const cp = sequence[round - 1];
      const offer = interpolateOffer(visible, floor, round, cp, previousCustomerPrices, 0);
      prices.push(offer);
      previousCustomerPrices = [...previousCustomerPrices, cp];
    }
    expect(prices).toEqual([44565, 41820, 41410]);
    expect(prices[1]).toBeGreaterThan(prices[2]);
  });

  test("final round, genuine engagement every round: convergence lands exactly on the customer's bid, never below it", () => {
    const offer = interpolateOffer(visible, floor, 3, customerPrice, [customerPrice, customerPrice], 0);
    expect(offer).toBe(customerPrice);
    expect(offer).toBeGreaterThanOrEqual(customerPrice);
  });

  test("regression: customer bidding BELOW list price is completely unchanged by this fix", () => {
    const belowListPrice = 39000;
    const offer = interpolateOffer(visible, floor, 1, belowListPrice, [], 0);
    expect(offer).toBe(39334); // identical to the pre-fix discount-zone formula's output
  });

  test("floor/ceiling safety: the premium-zone offer never drops below customerPrice (never less than what they offered) and never exceeds the aspiration ceiling, across every round", () => {
    let previousCustomerPrices: (number | undefined)[] = [];
    for (let round = 1; round <= 3; round++) {
      const offer = interpolateOffer(visible, floor, round, customerPrice, previousCustomerPrices, 0);
      expect(offer).toBeGreaterThanOrEqual(customerPrice);
      expect(offer).toBeLessThanOrEqual(aspiration);
      previousCustomerPrices = [...previousCustomerPrices, customerPrice];
    }
  });

  test("pricing-engine-v2 mirrors the same shape: genuine multi-round escalation stays above the customer's own bid each round, converging exactly on it by the final round", () => {
    const climbSequence = [42500, 43200, 43691]; // each step clears v2's real minImprovement floor
    let previousCustomerPrices: (number | undefined)[] = [];
    let previousOfferedPrices: number[] = [];
    let lastResult;
    for (let round = 1; round <= 3; round++) {
      const cp = climbSequence[round - 1];
      lastResult = computeOfferV2(
        {
          sessionId: "v2-premium-climb",
          skuId: "prop-sku",
          createdAt: CREATED_AT,
          visiblePrice: visible,
          hiddenFloorPrice: floor,
          round,
          customerPrice: cp,
          previousOfferedPrices: [...previousOfferedPrices].reverse(),
          previousCustomerPrices,
        },
        DEFAULT_GAMMA_CONFIG,
        STAGE_0_CONFIG,
        NEUTRAL_SIGNALS,
        3,
        DEFAULT_ENGINE_CONSTANTS,
      );
      expect(lastResult.offeredPrice).toBeGreaterThanOrEqual(cp); // never below what they offered
      expect(lastResult.offeredPrice).toBeLessThanOrEqual(cp * (1 + PREMIUM_STRETCH_PCT) + 1);
      previousOfferedPrices.push(lastResult.offeredPrice);
      previousCustomerPrices = [...previousCustomerPrices, cp];
    }
    expect(lastResult!.effectiveT).toBe(1);
    expect(lastResult!.everMovedForward).toBe(true);
    expect(lastResult!.offeredPrice).toBe(customerPrice); // exact convergence, matches v1's final-round behavior
  });
});

describe("regression: real production session cmsxs1hzl0006n7l51njg7eux (headphone SKU cmsxqgcwy..., qty 120)", () => {
  const visible = 39900;
  const floor = 38703;

  test("Bug 2 (offer computation): round-1 offer no longer discards a customer's generous opening ask", () => {
    const customerOpeningPrice = 42241;
    const offeredPrice = interpolateOffer(visible, floor, 1, customerOpeningPrice, [], 0);

    expect(offeredPrice).toBeGreaterThan(visible);
    expect(offeredPrice).toBeGreaterThanOrEqual(customerOpeningPrice);
    expect(offeredPrice).toBeLessThanOrEqual(customerOpeningPrice * (1 + PREMIUM_STRETCH_PCT));
    expect(offeredPrice).toBe(43086);
    expect(() => assertNoUnrequestedDiscount(offeredPrice, visible, customerOpeningPrice, "prod-session-round1")).not.toThrow();
  });

  test("Bug 1 (accept-decision, isolated): a customer counter that actually meets/beats the current offer DOES resolve to ACCEPT via Case 1", () => {
    const currentOfferedPrice = 39501; // round 1's offer in the live session, pre-fix value
    const customerCounter = 42241; // >= currentOfferedPrice

    const evaluation = decideAcceptOutcome({
      action: "REJECT", // the UI always sends REJECT for a counter-offer; decideAcceptOutcome upgrades it
      customerPrice: customerCounter,
      currentOfferedPrice,
      visiblePrice: visible,
      floorPrice: floor,
      round: 1,
      maxRounds: 3,
      tolerancePct: 0.05,
      earlyExitMinRound: 2,
      everMovedForward: true,
      bestPriorCustomerOffer: undefined,
    });

    expect(evaluation.outcome).toBe("accept");
    if (evaluation.outcome === "accept") {
      expect(evaluation.decision.acceptCase).toBe(1);
      expect(evaluation.decision.finalPrice).toBe(customerCounter);
    }
  });

  test("Bug 1 root cause reproduced: the actual round-1 RESPONSE in the live session (33576) correctly stayed below the round-1 offer, so REJECT was correct", () => {
    const round1OfferedPrice = 39501;
    const actualRound1Response = 33576;

    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: actualRound1Response,
      currentOfferedPrice: round1OfferedPrice,
      visiblePrice: visible,
      floorPrice: floor,
      round: 1,
      maxRounds: 3,
      tolerancePct: 0.05,
      earlyExitMinRound: 2,
      everMovedForward: true,
      bestPriorCustomerOffer: undefined,
    });

    expect(evaluation.outcome).toBe("continue");
  });
});

describe("regression: Sudden-Drop Bug fix (interpolateOffer ceiling: interpolated -> visiblePrice, later overturned into a real premium-zone climb)", () => {
  const visible = 39900;
  const floor = 38703;

  test("exact reproduction, live session 1 (cmsxs1hzl...): opening ask 42241 -> offer tests above their own ask, not the schedule's stingier 39501, and not flat-capped at 39900 or below their own bid either", () => {
    const offer = interpolateOffer(visible, floor, 1, 42241, [], 0);
    expect(offer).toBeGreaterThan(39501);
    expect(offer).toBeGreaterThan(39900);
    expect(offer).toBeGreaterThanOrEqual(42241);
    expect(offer).toBeLessThanOrEqual(42241 * (1 + PREMIUM_STRETCH_PCT));
    expect(offer).toBe(43086);
  });

  test("exact reproduction, live session 2 (cmsxsk9b7...): opening ask 42099 -> offer tests above their own ask, not the schedule's stingier 39501, and not flat-capped at 39900 or below their own bid either", () => {
    const offer = interpolateOffer(visible, floor, 1, 42099, [], 0);
    expect(offer).toBeGreaterThan(39501);
    expect(offer).toBeGreaterThan(39900);
    expect(offer).toBeGreaterThanOrEqual(42099);
    expect(offer).toBeLessThanOrEqual(42099 * (1 + PREMIUM_STRETCH_PCT));
    expect(offer).toBe(42941);
  });

  test("generous-but-not-full-price: customer offer between interpolated (39501) and visible (39900) pulls the offer UP toward it, not capped at interpolated", () => {
    const customerPrice = 39700;
    const offer = interpolateOffer(visible, floor, 1, customerPrice, [], 0);
    expect(offer).toBeGreaterThan(39501);
    expect(offer).toBeLessThanOrEqual(customerPrice);
    expect(offer).toBe(39567); // exact blended value at round 1's blendWeight (1/3)
  });

  test("normal case unaffected: customer offer BELOW interpolated behaves identically to before the fix (ceiling change is a mathematical no-op here)", () => {
    const customerPrice = 39000; // < interpolated (39501)
    const offer = interpolateOffer(visible, floor, 1, customerPrice, [], 0);
    expect(offer).toBeLessThanOrEqual(39501);
    expect(offer).toBe(39334); // same value the old interpolated-ceiling formula produced
  });

  test("floor safety unaffected: the fix only touched the upper bound (existing property suite already fuzzes this 1000x per describe block above)", () => {
    for (const customerPrice of [1, 100, floor - 500, floor]) {
      const offer = interpolateOffer(visible, floor, 3, customerPrice, [customerPrice, customerPrice], 0);
      expect(offer).toBeGreaterThanOrEqual(floor);
    }
  });

  test("v2 parity: blended is always <= baseOffer when customerPrice is in the premium zone (clampedCustomerPrice sits at the zone's floor, not its ceiling)", () => {
    for (const customerPrice of [39901, 40500, 42099, 50000]) {
      const result = computeOfferV2(
        {
          sessionId: `v2-parity-${customerPrice}`,
          skuId: "prop-sku",
          createdAt: CREATED_AT,
          visiblePrice: visible,
          hiddenFloorPrice: floor,
          round: 1,
          customerPrice,
          previousOfferedPrices: [],
          previousCustomerPrices: [],
        },
        DEFAULT_GAMMA_CONFIG,
        STAGE_0_CONFIG,
        NEUTRAL_SIGNALS,
        3,
        DEFAULT_ENGINE_CONSTANTS,
      );
      expect(result.blendedPreJitter).toBeLessThanOrEqual(result.baseOffer + 1e-6);
    }
  });
});

describe("property: customer opens at or below floor", () => {
  test(`${ITERATIONS} iterations clamped, never crashes, never nonsensical`, () => {
    const rng = makeRng(5005);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const opening = rupee(floor * rng()); // 0..floor
      for (const formula of ["v1", "v2"] as const) {
        const { evaluated } = checkCase(formula, visible, floor, 1, 3, [opening], `below-${i}`);
        expect(Number.isFinite(evaluated.offeredPrice)).toBe(true);
      }
    }
  });
});

describe("property: randomized signals and seller config, cross-product with randomized sequences", () => {
  test(`${ITERATIONS} iterations`, () => {
    const rng = makeRng(6006);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const maxRounds = 3;
      const history = randomWalkHistory(rng, floor, visible, maxRounds);
      const sellerConfig: SellerGammaConfig = {
        gammaBase: 0.05 + rng() * 0.85,
        gammaMin: 0.05,
        gammaMax: 0.9,
        alpha: rng() * 0.6,
        beta: rng() * 0.6,
        delta: 0,
        zeta: 0,
        eta: 0,
        tolerancePct: 0.01 + rng() * 0.09,
        earlyExitMinRound: 1 + Math.floor(rng() * maxRounds),
        minImprovementPct: 0.001 + rng() * 0.02,
      };
      const signals: EngineSignals = {
        stockPressure: rng(),
        demandScore: rng(),
        sigma: 0,
        regimeAdj: 0,
        ofi: 0,
        isRepeatRejection: false,
      };
      checkCase("v2", visible, floor, maxRounds, maxRounds, history, `signals-${i}`, sellerConfig, signals);
      checkCase("v1", visible, floor, maxRounds, maxRounds, history, `signals-v1-${i}`, sellerConfig);
    }
  });
});

describe("property: v1 and v2 never disagree on whether a safety invariant holds", () => {
  test(`${ITERATIONS} iterations`, () => {
    const rng = makeRng(7007);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const maxRounds = 3;
      const history = randomWalkHistory(rng, floor, visible, maxRounds);

      const v1 = evalV1({ visible, floor, round: maxRounds, customerPrice: history[history.length - 1], previousCustomerPrices: history.slice(0, -1), maxRounds });
      const v2 = evalV2({ sessionId: `parity-${i}`, visible, floor, round: maxRounds, customerPrice: history[history.length - 1], previousCustomerPrices: history.slice(0, -1), maxRounds });
      expect(v1.everMovedForward).toBe(v2.everMovedForward);
      expect(v1.genuineRoundsCount).toBe(v2.genuineRoundsCount);
    }
  });
});

describe("property: randomized maxRounds (2, 3, 4, 5)", () => {
  test(`${ITERATIONS} iterations across varying round counts`, () => {
    const rng = makeRng(8008);
    for (let i = 0; i < ITERATIONS; i++) {
      const maxRounds = 2 + Math.floor(rng() * 4); // 2..5
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const history = randomWalkHistory(rng, floor, visible, maxRounds);
      checkCase("v2", visible, floor, maxRounds, maxRounds, history, `rounds${maxRounds}-${i}`);
    }
  });
});

describe("property: idempotency and seed uniqueness", () => {
  test("same sessionId + inputs -> byte-identical output, across 1000 randomized inputs", () => {
    const rng = makeRng(9009);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const customerPrice = floor + rng() * (visible - floor);
      const a = evalV2({ sessionId: `idempotent-${i}`, visible, floor, round: 1, customerPrice, previousCustomerPrices: [], maxRounds: 3 });
      const b = evalV2({ sessionId: `idempotent-${i}`, visible, floor, round: 1, customerPrice, previousCustomerPrices: [], maxRounds: 3 });
      assertIdempotency(a, b, `iteration ${i}`);
    }
  });

  test("different sessionId, same everything else -> different offers, across 1000 randomized inputs", () => {
    const rng = makeRng(10010);
    for (let i = 0; i < ITERATIONS; i++) {
      const visible = 1000 + rng() * 9000;
      const floor = visible * (0.5 + rng() * 0.3);
      const customerPrice = floor + rng() * (visible - floor);
      const offers: number[] = [];
      for (let s = 0; s < 5; s++) {
        const r = evalV2({ sessionId: `seed-${i}-${s}`, visible, floor, round: 1, customerPrice, previousCustomerPrices: [], maxRounds: 3 });
        assertFloorSafety(r.offeredPrice, floor, `iteration ${i} session ${s}`);
        assertCeilingSafety(r.offeredPrice, visible, `iteration ${i} session ${s}`);
        offers.push(r.offeredPrice);
      }
      assertSeedUniqueness(offers, `iteration ${i}`);
    }
  });
});

describe("property: no floor leakage in serialized session-like objects", () => {
  test("a session object shaped like the real API response (hiddenFloorPrice omitted) never leaks the floor", () => {
    const floor = 1300;
    const safeSessionLike = {
      id: "sess-1",
      customerId: "cust-1",
      sellerId: "sell-1",
      visibleTierPrice: 1500,
      round: 2,
      status: "PENDING",
      rounds: [
        { round: 1, offeredPrice: 1463, customerPrice: 1400, response: "REJECT" },
        { round: 2, offeredPrice: 1431, customerPrice: null, response: null },
      ],
    };
    expect(() => assertNoFloorLeakage(safeSessionLike, floor)).not.toThrow();
  });

  test("negative control: a leaky object IS caught (proves the detector itself works, not vacuously passing)", () => {
    const floor = 1300;
    const leakySessionLike = {
      id: "sess-2",
      visibleTierPrice: 1500,
      hiddenFloorPrice: floor, // leaked
      rounds: [{ round: 1, offeredPrice: 1463 }],
    };
    expect(() => assertNoFloorLeakage(leakySessionLike, floor)).toThrow();

    const leakyByValue = {
      id: "sess-3",
      visibleTierPrice: 1500,
      nested: { somePrice: floor },
    };
    expect(() => assertNoFloorLeakage(leakyByValue, floor)).toThrow();
  });
});


describe("property: regression resistance (folded in from pricing-engine-v2-core.test.ts)", () => {
  test("naive linear fit across 500 pooled sessions cannot recover the true floor within 5% tolerance", () => {
    const V = 1000;
    const F = 500;
    const TOLERANCE = 0.05 * (V - F);
    const testRBase = 6;

    const points: { t: number; offeredPrice: number }[] = [];
    for (let i = 0; i < 500; i++) {
      const round = 1 + (i % (testRBase - 1));
      const result = computeOfferV2(
        { sessionId: `regression-session-${i}`, skuId: "regression-sku", createdAt: new Date(), visiblePrice: V, hiddenFloorPrice: F, round, customerPrice: undefined, previousOfferedPrices: [] },
        DEFAULT_GAMMA_CONFIG,
        STAGE_0_CONFIG,
        NEUTRAL_SIGNALS,
        testRBase,
      );
      points.push({ t: result.t, offeredPrice: result.offeredPrice });
    }

    const n = points.length;
    const tMean = points.reduce((s, p) => s + p.t, 0) / n;
    const pMean = points.reduce((s, p) => s + p.offeredPrice, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of points) {
      num += (p.t - tMean) * (p.offeredPrice - pMean);
      den += (p.t - tMean) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = pMean - slope * tMean;
    const fittedFloorEstimate = intercept + slope * 1;

    assertRegressionResistance(fittedFloorEstimate, F, TOLERANCE);
  });
});

import { describe, test, expect } from "bun:test";
import { computeOfferV2 } from "../../src/modules/negotiation/pricing-engine-v2/engine";
import { interpolateOffer, MAX_ROUNDS } from "../../src/modules/negotiation/legacy-linear-formula";
import { decideAcceptOutcome } from "../../src/modules/negotiation/accept-decision";
import {
  DEFAULT_ENGINE_CONSTANTS,
  DEFAULT_GAMMA_CONFIG,
  NEUTRAL_SIGNALS,
  STAGE_0_CONFIG,
  type EngineSignals,
  type OfferInputs,
  type SellerGammaConfig,
} from "../../src/modules/negotiation/pricing-engine-v2/types";
import { assertValidOffer, checkOfferValidity } from "../../src/modules/negotiation/pricing-engine-v2/validate";
import { PREMIUM_STRETCH_PCT } from "../../src/modules/negotiation/legacy-linear-formula";

const VISIBLE = 1500;
const FLOOR = 1300;
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

function makeInputs(overrides: Partial<OfferInputs> & { sessionId: string }): OfferInputs {
  return {
    skuId: "scenario-sku",
    createdAt: CREATED_AT,
    visiblePrice: VISIBLE,
    hiddenFloorPrice: FLOOR,
    round: 1,
    previousOfferedPrices: [],
    ...overrides,
  };
}

function offerV2(
  inputs: OfferInputs,
  signals: EngineSignals = NEUTRAL_SIGNALS,
  sellerConfig: SellerGammaConfig = DEFAULT_GAMMA_CONFIG,
  maxRounds = MAX_ROUNDS,
) {
  return computeOfferV2(inputs, sellerConfig, STAGE_0_CONFIG, signals, maxRounds, DEFAULT_ENGINE_CONSTANTS);
}

describe("Scenario: customer offers just below floor", () => {
  test("offer never goes below floor, in any round", () => {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const inputs = makeInputs({ sessionId: "scn-below-floor", round, customerPrice: FLOOR - 1 });
      const result = offerV2(inputs);
      assertValidOffer(result.offeredPrice, FLOOR, VISIBLE);
      expect(result.offeredPrice).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

describe("Scenario: customer offers above visible price", () => {
  test("premium zone: offer clamps to [customerPrice, aspiration] — tests above their bid, never below what they offered, never above the aspiration ceiling", () => {
    const customerPrice = VISIBLE + 200;
    let previousCustomerPrices: (number | undefined)[] = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const inputs = makeInputs({ sessionId: "scn-above-visible", round, customerPrice, previousCustomerPrices });
      const result = offerV2(inputs);
      assertValidOffer(result.offeredPrice, FLOOR, VISIBLE, customerPrice);
      expect(result.offeredPrice).toBeGreaterThanOrEqual(customerPrice);
      expect(result.offeredPrice).toBeLessThanOrEqual(customerPrice * (1 + PREMIUM_STRETCH_PCT));
      previousCustomerPrices = [...previousCustomerPrices, customerPrice];
    }
  });
});

describe("Scenario: customer offers exactly the floor, every round, and never moves off it", () => {
  test("never matches the customer's floor offer, in any round, when repeated with no genuine improvement", () => {
    const previousCustomerPrices: number[] = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const inputs = makeInputs({ sessionId: "scn-exact-floor", round, customerPrice: FLOOR, previousCustomerPrices: [...previousCustomerPrices] });
      const result = offerV2(inputs);
      assertValidOffer(result.offeredPrice, FLOOR, VISIBLE);
      expect(result.everMovedForward).toBe(false);
      expect(result.offeredPrice).toBeGreaterThan(FLOOR); 
      previousCustomerPrices.push(FLOOR);
    }
  });

  test("DOES match at the final round once the customer shows genuine improvement EVERY round (control proves the gate is about earned cumulative momentum, not the exact floor value)", () => {
    const opening = FLOOR - 200;
    const round2Price = FLOOR - 100;
    const inputs = makeInputs({
      sessionId: "scn-exact-floor-earned",
      round: MAX_ROUNDS,
      customerPrice: FLOOR,
      previousCustomerPrices: [opening, round2Price],
    });
    const result = offerV2(inputs);
    expect(result.everMovedForward).toBe(true);
    expect(result.offeredPrice).toBe(Math.round(FLOOR));
  });
});

describe("Scenario: customer never counters (round 1, no customerPrice)", () => {
  test("engine still produces a sane offer using stock/demand alone", () => {
    const inputs = makeInputs({ sessionId: "scn-no-counter", round: 1 });
    const result = offerV2(inputs);
    assertValidOffer(result.offeredPrice, FLOOR, VISIBLE);
    expect(result.customerInfluenceWeight).toBe(0); // no customer price -> no blending, pure baseOffer
    expect(result.blendedPreJitter).toBe(result.baseOffer); // w=0 means blended reduces exactly to baseOffer
    expect(result.offeredPrice).toBeCloseTo(result.baseOffer + result.jitter, 0); // offer is baseOffer + jitter, rounded to the nearest whole rupee
  });
});

describe("Scenario: final round hits floor exactly, given genuine momentum regardless of stock, demand, or gamma config", () => {
  test("stagnant/no-momentum final-round customerPrice does NOT hit the floor", () => {
    const noMomentumVariations: { customerPrice?: number }[] = [
      { customerPrice: undefined }, // never countered at all
      { customerPrice: FLOOR - 50 }, // below floor, no history to show it's an improvement over anything
    ];
    for (const [i, v] of noMomentumVariations.entries()) {
      const inputs = makeInputs({ sessionId: `scn-final-round-nomomentum-${i}`, round: MAX_ROUNDS, customerPrice: v.customerPrice });
      const result = offerV2(inputs);
      expect(result.everMovedForward).toBe(false);
      expect(result.offeredPrice).not.toBe(Math.round(FLOOR));
    }
  });

  test("genuine-momentum final-round customerPrice hits the floor, regardless of stock, demand, or gamma config (discount zone only — customerPrice stays below visible)", () => {
    const variations: { customerPrice?: number; signals: EngineSignals; sellerConfig: SellerGammaConfig }[] = [
      { customerPrice: 1450, signals: NEUTRAL_SIGNALS, sellerConfig: DEFAULT_GAMMA_CONFIG },
      { customerPrice: 1400, signals: { ...NEUTRAL_SIGNALS, stockPressure: 0.9, demandScore: 0.1 }, sellerConfig: DEFAULT_GAMMA_CONFIG },
      { customerPrice: 1400, signals: NEUTRAL_SIGNALS, sellerConfig: { ...DEFAULT_GAMMA_CONFIG, gammaBase: 0.9, gammaMax: 0.95 } },
    ];
    for (const [i, v] of variations.entries()) {
      const previousCustomerPrices = [FLOOR - 300, FLOOR - 100];
      const inputs = makeInputs({ sessionId: `scn-final-round-${i}`, round: MAX_ROUNDS, customerPrice: v.customerPrice, previousCustomerPrices });
      const result = offerV2(inputs, v.signals, v.sellerConfig);
      expect(result.everMovedForward).toBe(true);
      expect(result.offeredPrice).toBe(Math.round(FLOOR));
      expect(result.isFinalRound).toBe(true);
    }
  });

  test("genuine-momentum final-round customerPrice hits the customer's OWN bid, not the floor, once that bid is in the premium zone (mirror image of the discount-zone case above)", () => {
    const customerPrice = VISIBLE + 100;
    const previousCustomerPrices = [VISIBLE - 300, VISIBLE - 100]; // ramping up toward the premium bid
    const inputs = makeInputs({ sessionId: "scn-final-round-premium", round: MAX_ROUNDS, customerPrice, previousCustomerPrices });
    const result = offerV2(inputs);
    expect(result.everMovedForward).toBe(true);
    expect(result.offeredPrice).toBe(customerPrice);
    expect(result.isFinalRound).toBe(true);
  });
});

describe("Scenario: high stock pressure vs low stock pressure, same everything else", () => {
  test("scarce stock (high stockPressure) produces a higher (less generous) offer than abundant stock", () => {
    const inputs = makeInputs({ sessionId: "scn-stock-compare", round: 1, customerPrice: 1400 });
    const highPressure = offerV2(inputs, { ...NEUTRAL_SIGNALS, stockPressure: 0.9 });
    const lowPressure = offerV2(inputs, { ...NEUTRAL_SIGNALS, stockPressure: 0.1 });

    assertValidOffer(highPressure.offeredPrice, FLOOR, VISIBLE);
    assertValidOffer(lowPressure.offeredPrice, FLOOR, VISIBLE);
    expect(highPressure.gamma).toBeGreaterThan(lowPressure.gamma);
    expect(highPressure.offeredPrice).toBeGreaterThan(lowPressure.offeredPrice);
  });
});

describe("Scenario: high demand vs low demand, same everything else", () => {
  test("high demandScore actually produces a LOWER offer than low demandScore, per gamma's -beta*demandScore term as specified", () => {
    const inputs = makeInputs({ sessionId: "scn-demand-compare", round: 1, customerPrice: 1400 });
    const highDemand = offerV2(inputs, { ...NEUTRAL_SIGNALS, demandScore: 0.9 });
    const lowDemand = offerV2(inputs, { ...NEUTRAL_SIGNALS, demandScore: 0.1 });

    assertValidOffer(highDemand.offeredPrice, FLOOR, VISIBLE);
    assertValidOffer(lowDemand.offeredPrice, FLOOR, VISIBLE);
    expect(highDemand.gamma).toBeLessThan(lowDemand.gamma);
    expect(highDemand.offeredPrice).toBeLessThan(lowDemand.offeredPrice);
  });
});

describe("Scenario: same inputs, same sessionId, called twice", () => {
  test("byte-identical output (idempotency)", () => {
    const inputs = makeInputs({ sessionId: "scn-idempotent", round: 1, customerPrice: 1420 });
    const a = offerV2(inputs);
    const b = offerV2(inputs);
    expect(b).toEqual(a);
  });
});

describe("Scenario: same inputs, different sessionId", () => {
  test("output differs (seed uniqueness) but both stay within valid bounds", () => {
    const a = offerV2(makeInputs({ sessionId: "scn-seed-a", round: 1, customerPrice: 1420 }));
    const b = offerV2(makeInputs({ sessionId: "scn-seed-b", round: 1, customerPrice: 1420 }));
    assertValidOffer(a.offeredPrice, FLOOR, VISIBLE);
    assertValidOffer(b.offeredPrice, FLOOR, VISIBLE);
    expect(a.offeredPrice).not.toBe(b.offeredPrice);
  });
});

describe("Scenario: accept-decision logic (Cases 1-4) capture upside, early exit, final-round settlement", () => {
  const TOLERANCE_PCT = 0.03;
  const EARLY_EXIT_MIN_ROUND = 2;

  test("Case 1 customer offers above the system's ask: accept at the customer's price, not the system's ask (regression test for the exact ₹1900/₹1800/customerPrice=1840 case)", () => {
    const visible = 1900;
    const floor = 1800;
    const round = MAX_ROUNDS;
    const previousCustomerPrices = [1700, 1780]; // genuine round-over-round improvement leading up to this round's 1840
    const inputs = makeInputs({
      sessionId: "scn-case1-upside",
      visiblePrice: visible,
      hiddenFloorPrice: floor,
      round,
      customerPrice: 1840,
      previousCustomerPrices,
    });
    const result = offerV2(inputs);
    expect(result.everMovedForward).toBe(true);
    expect(result.offeredPrice).toBe(1800); // the system's ask is unchanged by this fix only the ACCEPT decision changes

    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: 1840,
      currentOfferedPrice: result.offeredPrice,
      visiblePrice: visible,
      floorPrice: floor,
      round,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(evaluation.outcome).toBe("accept");
    if (evaluation.outcome !== "accept") throw new Error("unreachable");
    expect(evaluation.decision.acceptCase).toBe(1);
    expect(evaluation.decision.finalPrice).toBe(1840); // captures the customer's higher number this is the fix
    expect(evaluation.decision.finalPrice).not.toBe(1800); // NOT the system's ask, which is what the old bug charged
    expect(Number.isInteger(evaluation.decision.finalPrice)).toBe(true);
  });

  test("Case 1 an above-visible customer offer is captured in full, not flat-capped at the visible price (overturns the earlier no-unrequested-discount flat cap)", () => {
    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: 1650,
      currentOfferedPrice: 1400,
      visiblePrice: 1500,
      floorPrice: 1300,
      round: 2,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(evaluation.outcome).toBe("accept");
    if (evaluation.outcome !== "accept") throw new Error("unreachable");
    expect(evaluation.decision.acceptCase).toBe(1);
    expect(evaluation.decision.finalPrice).toBe(1650); // the customer's own bid, not flat-capped at 1500
  });

  test("Case 2 customer within tolerance in round >= earlyExitMinRound: accept at the SELLER's offered price, not the customer's lower number", () => {
    const currentOfferedPrice = 1000;
    const customerPrice = 980; // 2% below the ask, inside the 3% tolerance band
    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice,
      currentOfferedPrice,
      visiblePrice: 1500,
      floorPrice: 900,
      round: 2,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(evaluation.outcome).toBe("accept");
    if (evaluation.outcome !== "accept") throw new Error("unreachable");
    expect(evaluation.decision.acceptCase).toBe(2);
    expect(evaluation.decision.finalPrice).toBe(currentOfferedPrice); // 1000 the seller's number
    expect(evaluation.decision.finalPrice).not.toBe(customerPrice); // NOT the customer's lower 980
  });

  test("Case 2 the identical near-tolerance gap in round 1 does NOT early-exit (earlyExitMinRound not yet reached); negotiation continues (Case 4)", () => {
    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: 980,
      currentOfferedPrice: 1000,
      visiblePrice: 1500,
      floorPrice: 900,
      round: 1,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(evaluation.outcome).toBe("continue"); // Case 4 same inputs that trigger Case 2 at round 2 do NOT trigger it at round 1
  });

  test("Case 3 (Option B) customer never submits a genuine round-3 counter: REJECTED, not an auto-accept at floor (corrected from the prior pass's unconditional-accept version)", () => {
    const visible = 1500;
    const floor = 1300;
    const round = MAX_ROUNDS;

    const bareReject = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: undefined,
      currentOfferedPrice: floor, // the final round's own offer is always forced to floor
      visiblePrice: visible,
      floorPrice: floor,
      round,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(bareReject.outcome).toBe("rejected");

    const stationaryPrice = 1000;
    const belowFloorCounter = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: stationaryPrice,
      currentOfferedPrice: floor,
      visiblePrice: visible,
      floorPrice: floor,
      round,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(belowFloorCounter.outcome).toBe("rejected");
  });

  test("Case 3 (Option B) customer DOES submit a genuine, qualifying round-3 counter (>= floor): still ACCEPTs at that price, unchanged from before Option B must not regress active engagement", () => {
    const visible = 1900;
    const floor = 1800;
    const round = MAX_ROUNDS;
    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: 1840,
      currentOfferedPrice: floor,
      visiblePrice: visible,
      floorPrice: floor,
      round,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(evaluation.outcome).toBe("accept");
    if (evaluation.outcome !== "accept") throw new Error("unreachable");
    expect(evaluation.decision.finalPrice).toBe(1840);
    expect(evaluation.decision.finalPrice).toBeGreaterThan(floor);
  });

  test("Case 3's own accept branch, isolated: if a final-round ask were ever above the floor, a qualifying customer offer between floor and that ask is still captured, not dropped to floor", () => {
    const visible = 1500;
    const floor = 1300;
    const round = MAX_ROUNDS;
    const hypotheticalFinalAsk = 1360;
    const customerPrice = 1310;
    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice,
      currentOfferedPrice: hypotheticalFinalAsk,
      visiblePrice: visible,
      floorPrice: floor,
      round,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(evaluation.outcome).toBe("accept");
    if (evaluation.outcome !== "accept") throw new Error("unreachable");
    expect(evaluation.decision.acceptCase).toBe(3);
    expect(evaluation.decision.finalPrice).toBe(customerPrice); // captures 1310, not dropped to floor (1300)
    expect(evaluation.decision.finalPrice).toBeGreaterThan(floor);
  });

  test("frontend-contract risk, documented: an algorithmic default counterPrice can accidentally qualify as Case 3's 'genuine' counter for low-floor SKUs", () => {
    const floor = 10;
    const visible = 20;
    const round = MAX_ROUNDS;
    const currentOfferedPrice = floor; // final round, forced to floor
    const frontendDefaultCounterPrice = Math.round(currentOfferedPrice * 0.95);
    expect(frontendDefaultCounterPrice).toBe(floor); // the coincidence, verified

    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: frontendDefaultCounterPrice,
      currentOfferedPrice,
      visiblePrice: visible,
      floorPrice: floor,
      round,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(evaluation.outcome).toBe("accept");
  });

  test("a genuine near-miss in round 1 triggers no accept case negotiation is still genuinely ongoing (mirrors the 1500/1300/1450 example from the design conversation)", () => {
    const inputs = makeInputs({ sessionId: "scn-near-miss", round: 1, customerPrice: 1450 });
    const result = offerV2(inputs);
    assertValidOffer(result.offeredPrice, FLOOR, VISIBLE);
    expect(result.offeredPrice).toBeGreaterThan(1450);

    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: 1450,
      currentOfferedPrice: result.offeredPrice,
      visiblePrice: VISIBLE,
      floorPrice: FLOOR,
      round: 1,
      maxRounds: MAX_ROUNDS,
      tolerancePct: TOLERANCE_PCT,
      earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
    });
    expect(evaluation.outcome).toBe("continue");
  });

  test("every accept-decision output is a whole number, including when the offer it's compared against was jitter-affected", () => {
    for (let i = 0; i < 100; i++) {
      const visible = 1000 + i * 37;
      const floor = visible - 150 - (i % 40);
      const round = 1 + (i % MAX_ROUNDS);
      const customerPrice = floor + (i % 250);
      const inputs = makeInputs({ sessionId: `scn-whole-${i}`, visiblePrice: visible, hiddenFloorPrice: floor, round, customerPrice });
      const result = offerV2(inputs);
      expect(Number.isInteger(result.offeredPrice)).toBe(true);

      const evaluation = decideAcceptOutcome({
        action: "REJECT",
        customerPrice,
        currentOfferedPrice: result.offeredPrice,
        visiblePrice: visible,
        floorPrice: floor,
        round,
        maxRounds: MAX_ROUNDS,
        tolerancePct: TOLERANCE_PCT,
        earlyExitMinRound: EARLY_EXIT_MIN_ROUND,
      });
      if (evaluation.outcome === "accept") expect(Number.isInteger(evaluation.decision.finalPrice)).toBe(true);
    }
  });
});

describe("Scenario: v1 (old linear) vs v2 (new engine) comparison", () => {
  test("side-by-side comparison across all 3 rounds, logged for inspection", () => {
    console.log("\n  round | v1_linear | pricing-engine-v2 | delta");
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const customerPrice = 1400 + round * 15;
      const v1 = interpolateOffer(VISIBLE, FLOOR, round, customerPrice);
      const v2 = offerV2(makeInputs({ sessionId: "scn-v1-vs-v2", round, customerPrice })).offeredPrice;
      console.log(`  ${round}     | ₹${v1.toFixed(2)}  | ₹${v2.toFixed(2)}            | ₹${(v2 - v1).toFixed(2)}`);

      expect(checkOfferValidity(v1, FLOOR, VISIBLE).valid).toBe(true);
      expect(checkOfferValidity(v2, FLOOR, VISIBLE).valid).toBe(true);
      expect(Number.isInteger(v1)).toBe(true);
      expect(Number.isInteger(v2)).toBe(true);
    }
  });
});
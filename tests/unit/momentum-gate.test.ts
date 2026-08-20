import { describe, test, expect } from "bun:test";
import { computeMomentumState } from "../../src/modules/negotiation/momentum-gate";
import { computeOfferV2 } from "../../src/modules/negotiation/pricing-engine-v2/engine";
import { interpolateOffer, MAX_ROUNDS } from "../../src/modules/negotiation/legacy-linear-formula";
import { decideAcceptOutcome } from "../../src/modules/negotiation/accept-decision";
import {
  DEFAULT_ENGINE_CONSTANTS,
  DEFAULT_GAMMA_CONFIG,
  NEUTRAL_SIGNALS,
  STAGE_0_CONFIG,
  type OfferInputs,
} from "../../src/modules/negotiation/pricing-engine-v2/types";

const VISIBLE = 1500;
const FLOOR = 1300;
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const MIN_IMPROVEMENT = Math.max(
  DEFAULT_ENGINE_CONSTANTS.minImprovementFloorRupees,
  DEFAULT_GAMMA_CONFIG.minImprovementPct * (VISIBLE - FLOOR),
);

function makeInputs(overrides: Partial<OfferInputs> & { sessionId: string }): OfferInputs {
  return {
    skuId: "momentum-sku",
    createdAt: CREATED_AT,
    visiblePrice: VISIBLE,
    hiddenFloorPrice: FLOOR,
    round: 1,
    previousOfferedPrices: [],
    ...overrides,
  };
}

function offerV2(inputs: OfferInputs) {
  return computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, MAX_ROUNDS, DEFAULT_ENGINE_CONSTANTS);
}

describe("computeMomentumState — the shared pure gate", () => {
  test("round 1 alone: effectiveT = t(1), genuineThisRound = true, but everMovedForward = false (t(1)=1/3 hasn't reached full concession)", () => {
    const result = computeMomentumState([1400], (r) => r / 3, 10, 3);
    expect(result.effectiveT).toBe(1 / 3);
    expect(result.genuineThisRound).toBe(true);
    expect(result.everMovedForward).toBe(false);
  });

  test("a customer's very first-ever number (no prior cp to compare against) counts as genuine, same as round 1", () => {
    // round 1 had no customerPrice at all; round 2 is the first real number.
    const result = computeMomentumState([undefined, 1400], (r) => r / 3, 10, 3);
    expect(result.genuineThisRound).toBe(true);
    expect(result.effectiveT).toBe(2 / 3);
    expect(result.everMovedForward).toBe(false); // 2/3 hasn't reached full concession yet
  });

  test("a bare reject (no customerPrice this round) is never genuine, and freezes effectiveT", () => {
    const result = computeMomentumState([1400, undefined], (r) => r / 3, 10, 3);
    expect(result.genuineThisRound).toBe(false);
    expect(result.everMovedForward).toBe(false);
    expect(result.effectiveT).toBe(1 / 3); // frozen at round 1's value
  });

  test("effectiveT never advances by more than one round's worth per genuine round, even across many genuine rounds in a row", () => {
    // rawT jumps straight to 1 after round 1 (simulates a formula where t(r) saturates fast) —
    // the step cap must still hold effectiveT to at most genuineRounds/maxRounds regardless.
    const rawT = (r: number) => (r === 1 ? 1 / 5 : 1);
    const result = computeMomentumState([1000, 1010, 1020], rawT, 5, 5);
    expect(result.effectiveT).toBeCloseTo(3 / 5, 9); // 3 genuine rounds, capped at 3/5, not jumped to 1
    expect(result.everMovedForward).toBe(false);
  });
});

describe("EXACT regression transcript from live interactive testing: opening 1460, round1 response 1480, round2 response 1430 (a genuine +20 improvement followed by a -50 retreat)", () => {
  test("round 2's effectiveT stays frozen at round 1's value (the retreat does not get a fresh, more-decayed curve)", () => {
    const round1 = offerV2(makeInputs({ sessionId: "regress-r1", round: 1, customerPrice: 1460, previousCustomerPrices: [] }));
    // Round 1 is always "genuine" by definition (nothing to compare against) — round 1's effectiveT is never frozen.
    expect(round1.effectiveT).toBe(round1.t);

    const round2Genuine = offerV2(
      makeInputs({ sessionId: "regress-r2a", round: 2, customerPrice: 1480, previousCustomerPrices: [1460] }),
    );
    // 1480 - 1460 = +20 >= minImprovement -> genuine -> effectiveT(2) = t(2), NOT frozen.
    expect(round2Genuine.genuineMomentumThisRound).toBe(true);
    expect(round2Genuine.effectiveT).toBe(round2Genuine.t);

    const round3Regressed = offerV2(
      makeInputs({ sessionId: "regress-r3", round: 3, customerPrice: 1430, previousCustomerPrices: [1460, 1480] }),
    );
    // 1430 - 1480 = -50, a retreat -> NOT genuine -> effectiveT(3) freezes at effectiveT(2) = t(2), not t(3).
    expect(round3Regressed.genuineMomentumThisRound).toBe(false);
    expect(round3Regressed.effectiveT).not.toBe(round3Regressed.t);
    expect(round3Regressed.effectiveT).toBe(2 / MAX_ROUNDS); // = t(2), the last genuine round
  });

  test("the customer never gets a WORSE deal than what they'd already offered in an earlier round — this is the exact property the live-testing bug violated", () => {
    // Round 3 is the final round. everMovedForward is true here (round
    // 1->2 was genuine), so the engine's final-round override still
    // applies (F is earned) — but the ACCEPT decision is what actually
    // determines the deal price, and that's where the live bug lived:
    // the old code closed the deal at round 3's decayed offer (1436),
    // forty-four rupees BELOW the 1480 the customer had already put on
    // the table one round earlier.
    const round3 = offerV2(makeInputs({ sessionId: "regress-final", round: 3, customerPrice: 1430, previousCustomerPrices: [1460, 1480] }));

    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: 1430,
      currentOfferedPrice: round3.offeredPrice,
      visiblePrice: VISIBLE,
      floorPrice: FLOOR,
      round: 3,
      maxRounds: MAX_ROUNDS,
      tolerancePct: 0.03,
      earlyExitMinRound: 2,
      everMovedForward: round3.everMovedForward,
      bestPriorCustomerOffer: 1480, // the customer's own best prior offer — see accept-decision.ts's clamp
    });

    const dealPrice = evaluation.outcome === "accept" ? evaluation.decision.finalPrice : null;
    const priorMaxOffer = 1480; // the customer's own best prior offer
    if (dealPrice !== null) {
      expect(dealPrice).toBeGreaterThanOrEqual(priorMaxOffer);
    }
    // The regression this fix specifically closes: whatever happens
    // (accept or reject), it must never be a deal below 1480.
  });
});

describe("stagnant customer: flat ₹1300 across all 3 rounds, floor=1300", () => {
  test("effectiveT freezes after round 1 (rounds 2-3 show zero improvement); round 3 does NOT resolve to floor via unconditional decay — Case 3 correctly REJECTs since the customer's flat offer never clears the (now-elevated) frozen ask", () => {
    const previousCustomerPrices: number[] = [];
    let lastResult;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      lastResult = offerV2(makeInputs({ sessionId: "stagnant", round, customerPrice: FLOOR, previousCustomerPrices: [...previousCustomerPrices] }));
      previousCustomerPrices.push(FLOOR);
    }
    const round3 = lastResult!;
    expect(round3.everMovedForward).toBe(false);
    expect(round3.offeredPrice).toBeGreaterThan(FLOOR); // never decayed all the way down

    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: FLOOR, // the customer's flat, unchanging offer
      currentOfferedPrice: round3.offeredPrice, // the frozen, non-floor ask
      visiblePrice: VISIBLE,
      floorPrice: FLOOR,
      round: MAX_ROUNDS,
      maxRounds: MAX_ROUNDS,
      tolerancePct: 0.03,
      earlyExitMinRound: 2,
      everMovedForward: round3.everMovedForward,
    });
    // FLOOR clears the absolute floor (Case 3's old, now-insufficient
    // condition) but does NOT clear the frozen ask (Case 1) and the
    // customer never earned the override (Case 3's new everMovedForward
    // requirement) — REJECTED, not an auto-accept at their stagnant number.
    expect(evaluation.outcome).toBe("rejected");
  });
});

describe("genuine forward-moving customer (increment style: +20/round) — no regression on the already-correct case", () => {
  test("effectiveT never freezes; behaves identically to the raw t(r) curve at every round", () => {
    const previousCustomerPrices: number[] = [];
    let customerPrice = 1350;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const result = offerV2(makeInputs({ sessionId: "increment", round, customerPrice, previousCustomerPrices: [...previousCustomerPrices] }));
      expect(result.effectiveT).toBe(result.t); // never frozen
      if (round >= 2) expect(result.genuineMomentumThisRound).toBe(true);
      previousCustomerPrices.push(customerPrice);
      customerPrice += 20;
    }
  });

  test("final round earns the floor override (everMovedForward true throughout)", () => {
    const result = offerV2(
      makeInputs({ sessionId: "increment-final", round: MAX_ROUNDS, customerPrice: 1390, previousCustomerPrices: [1350, 1370] }),
    );
    expect(result.everMovedForward).toBe(true);
    expect(result.offeredPrice).toBe(Math.round(FLOOR));
  });
});

describe("mixed: forward round 1->2, regressive round 2->3", () => {
  test("the freeze applies to the regressive round, capping cumulative concession at 2 genuine rounds out of 3 — one later regression means the floor is NOT fully earned", () => {
    // round1=1350 -> round2=1400 (+50, genuine) -> round3=1380 (-20, regressive)
    const round2 = offerV2(makeInputs({ sessionId: "mixed-r2", round: 2, customerPrice: 1400, previousCustomerPrices: [1350] }));
    expect(round2.genuineMomentumThisRound).toBe(true);
    expect(round2.effectiveT).toBe(round2.t); // round 2 itself is NOT frozen

    const round3 = offerV2(makeInputs({ sessionId: "mixed-r3", round: 3, customerPrice: 1380, previousCustomerPrices: [1350, 1400] }));
    expect(round3.genuineMomentumThisRound).toBe(false); // round 3's OWN transition is regressive
    expect(round3.effectiveT).not.toBe(round3.t); // round 3 IS frozen (at round 2's effectiveT)
    expect(round3.effectiveT).toBe(2 / MAX_ROUNDS); // 2 genuine rounds out of 3, capped there
    // Only 2 of 3 rounds were genuine — cumulative concession caps below
    // full, so the floor is NOT earned even though there WAS earlier
    // genuine movement. This is the incremental-unfreeze fix: a customer
    // doesn't get to bank "earned it once" and coast on a later regression.
    expect(round3.everMovedForward).toBe(false);
    expect(round3.offeredPrice).toBeGreaterThan(FLOOR);
  });
});

describe("v1_linear gets the same gate — it's the formula serving ALL traffic whenever the v2 rollout is at its 0% default, not a comparison-only baseline", () => {
  test("stagnant customer (flat price, v1): final round does not drop to floor", () => {
    const round3 = interpolateOffer(VISIBLE, FLOOR, MAX_ROUNDS, FLOOR, [FLOOR, FLOOR], MIN_IMPROVEMENT);
    expect(round3).toBeGreaterThan(FLOOR);
  });

  test("genuine forward-moving customer (v1): final round settles at the customer's own number, not force-dropped past it to floor", () => {
    const round3 = interpolateOffer(VISIBLE, FLOOR, MAX_ROUNDS, 1390, [1350, 1370], MIN_IMPROVEMENT);
    expect(round3).toBe(1390);
    expect(round3).toBeGreaterThan(FLOOR);
  });

  test("default minImprovement=0 with a genuine (or flat) EXPLICIT history preserves pre-gate behavior; an isolated call with NO history does not (there's nothing to confirm movement against, so it fails safe rather than granting the floor by default)", () => {
    // Flat history, but minImprovement=0 means a 0 delta still clears the
    // (zero) threshold — old unconditional-floor behavior, preserved.
    const flatWithHistory = interpolateOffer(VISIBLE, FLOOR, MAX_ROUNDS, FLOOR, [FLOOR, FLOOR], 0);
    expect(flatWithHistory).toBe(Math.round(FLOOR));

    // The exact old call shape (no previousCustomerPrices/minImprovement
    // args at all) — this is NOT equivalent to "3 flat rounds happened,"
    // it's equivalent to "we don't know what happened before this call."
    // That ambiguity resolves to NOT granting the floor, which is the
    // correct, conservative default — the alternative (defaulting to
    // "assume genuine") would silently reopen the exact bug this gate
    // exists to close for any caller that forgot to pass real history.
    const isolatedNoHistory = interpolateOffer(VISIBLE, FLOOR, MAX_ROUNDS, FLOOR);
    expect(isolatedNoHistory).not.toBe(Math.round(FLOOR));
    expect(isolatedNoHistory).toBeGreaterThan(FLOOR);
  });
});

describe("property test: across >=500 fuzzed sessions (including regressive ones), the final accepted price is never lower than the customer's own best prior offer", () => {
  function randomSequence(seed: number): number[] {
    // 1-3 rounds of customerPrice, some regressive, some flat, some
    // genuinely improving, some with gaps (undefined) — deliberately
    // wide-ranging to exercise every branch of the momentum gate.
    let x = seed;
    const rand = () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x / 0x7fffffff;
    };
    const length = 1 + Math.floor(rand() * 3);
    const seq: (number | undefined)[] = [];
    let price = FLOOR + rand() * (VISIBLE - FLOOR);
    for (let i = 0; i < length; i++) {
      if (rand() < 0.15) {
        seq.push(undefined); // bare reject this round
      } else {
        // can move up, down, or stay — deliberately includes regressions
        price = Math.max(FLOOR, Math.min(VISIBLE, price + (rand() - 0.5) * 400));
        seq.push(price);
      }
    }
    return seq as number[];
  }

  test("property holds across 500 randomized sequences, evaluated at whichever round is 'final' for that sequence", () => {
    let acceptedCount = 0;
    for (let i = 0; i < 500; i++) {
      const seq = randomSequence(i + 1);
      const round = seq.length; // treat the last generated round as "the final round" for this case
      const boundedRound = Math.min(round, MAX_ROUNDS);
      const previousCustomerPrices = seq.slice(0, boundedRound - 1);
      const customerPrice = seq[boundedRound - 1];

      const offer = offerV2(
        makeInputs({ sessionId: `fuzz-momentum-${i}`, round: boundedRound, customerPrice, previousCustomerPrices }),
      );

      const priorOffers = previousCustomerPrices.filter((p): p is number => p !== undefined);
      const bestPriorCustomerOffer = priorOffers.length ? Math.max(...priorOffers) : undefined;

      const evaluation = decideAcceptOutcome({
        action: "REJECT",
        customerPrice,
        currentOfferedPrice: offer.offeredPrice,
        visiblePrice: VISIBLE,
        floorPrice: FLOOR,
        round: boundedRound,
        maxRounds: MAX_ROUNDS,
        tolerancePct: 0.03,
        earlyExitMinRound: 2,
        everMovedForward: offer.everMovedForward,
        bestPriorCustomerOffer,
      });

      if (evaluation.outcome === "accept") {
        acceptedCount++;
        const bestPriorOffer = priorOffers.length ? Math.max(...priorOffers) : -Infinity;
        expect(evaluation.decision.finalPrice).toBeGreaterThanOrEqual(Math.round(bestPriorOffer));
      }
    }
    // Sanity: the fuzz actually exercised the accept path meaningfully.
    expect(acceptedCount).toBeGreaterThan(0);
  });
});

describe("incremental-unfreeze exploit (closed): 2 stagnant rounds then one small qualifying move on the final round", () => {
  // V=1500, F=1300, maxRounds=3. Round 1: cp=1300 (genuine baseline).
  // Round 2: cp=1300 (stagnant, frozen). Round 3: cp=1310 (+10, clears
  // minImprovement, a small genuine move). Before this fix, ANY genuine
  // round fully unfroze effectiveT to the CURRENT round's t — one token
  // +10 move on the final round would jump effectiveT straight to 1.0,
  // dropping the offer to the floor and letting the customer walk away
  // with a near-floor price (1310) for one token gesture, same reward as
  // genuine full-session engagement.
  test("effectiveT advances by exactly one round's increment from where it was frozen, not to the clock's current position", () => {
    const round3 = offerV2(makeInputs({ sessionId: "unfreeze-exploit", round: 3, customerPrice: 1310, previousCustomerPrices: [1300, 1300] }));
    expect(round3.genuineMomentumThisRound).toBe(true); // 1310-1300=10 >= minImprovement, this round's move IS genuine
    expect(round3.effectiveT).toBeCloseTo(2 / 3, 9); // frozen-at-1/3 + one step (1/3) = 2/3, NOT t(3)=1.0
    expect(round3.effectiveT).not.toBe(round3.t);
  });

  test("the round-3 offer is NOT the floor", () => {
    const round3 = offerV2(makeInputs({ sessionId: "unfreeze-exploit-offer", round: 3, customerPrice: 1310, previousCustomerPrices: [1300, 1300] }));
    expect(round3.offeredPrice).toBeGreaterThan(FLOOR);
  });

  test("Case 1 does not fire at 1310 against the (correctly non-floor) offer — the exploit's actual payoff — and Case 3 doesn't rescue it either: the customer cannot walk away with a near-floor price off one small late move", () => {
    const round3 = offerV2(makeInputs({ sessionId: "unfreeze-exploit-accept", round: 3, customerPrice: 1310, previousCustomerPrices: [1300, 1300] }));
    expect(round3.everMovedForward).toBe(false); // 2/3 cumulative momentum, not fully earned

    const evaluation = decideAcceptOutcome({
      action: "REJECT",
      customerPrice: 1310,
      currentOfferedPrice: round3.offeredPrice,
      visiblePrice: VISIBLE,
      floorPrice: FLOOR,
      round: 3,
      maxRounds: MAX_ROUNDS,
      tolerancePct: 0.03,
      earlyExitMinRound: 2,
      everMovedForward: round3.everMovedForward,
      bestPriorCustomerOffer: 1300,
    });
    // Neither Case 1 (offer is elevated, 1310 doesn't clear it) nor Case 3
    // (everMovedForward is false, momentum wasn't fully earned) fires.
    expect(evaluation.outcome).toBe("rejected");
  });

  test("control: genuine movement EVERY round still reaches the floor exactly (the fix doesn't punish real full-session engagement)", () => {
    const round3 = offerV2(makeInputs({ sessionId: "unfreeze-control", round: 3, customerPrice: 1300, previousCustomerPrices: [1100, 1200] }));
    expect(round3.effectiveT).toBe(1);
    expect(round3.everMovedForward).toBe(true);
    expect(round3.offeredPrice).toBe(Math.round(FLOOR));
  });

  test("same exploit shape holds for v1_linear", () => {
    const round3 = interpolateOffer(VISIBLE, FLOOR, MAX_ROUNDS, 1310, [1300, 1300], MIN_IMPROVEMENT);
    expect(round3).toBeGreaterThan(FLOOR);
  });
});

import { describe, test, expect } from "bun:test";
import { computeOfferV2 } from "../../src/modules/negotiation/pricing-engine-v2/engine";
import { DEFAULT_GAMMA_CONFIG, NEUTRAL_SIGNALS, STAGE_0_CONFIG } from "../../src/modules/negotiation/pricing-engine-v2/types";
import type { OfferInputs } from "../../src/modules/negotiation/pricing-engine-v2/types";

const R_BASE = 3;

function randomOfferInputs(i: number): OfferInputs {
  const V = 100 + Math.random() * 9900;
  const F = V * (0.3 + Math.random() * 0.5);
  const round = 1 + Math.floor(Math.random() * R_BASE);
  const customerPrice = Math.random() > 0.3 ? F + Math.random() * (V - F) : undefined;
  const previousOfferedPrices =
    round > 1
      ? [F + Math.random() * (V - F), F + Math.random() * (V - F)]
      : [];
  return {
    sessionId: `fuzz-session-${i}-${Math.random().toString(36).slice(2)}`,
    skuId: `fuzz-sku-${i % 37}`,
    createdAt: new Date(),
    visiblePrice: V,
    hiddenFloorPrice: F,
    round,
    customerPrice,
    previousOfferedPrices,
  };
}

describe("pricing-engine-v2 Stage 0 core property tests", () => {
  test("offeredPrice is always within [F, V] across >=500 randomized cases", () => {
    const RUPEE = 1;
    for (let i = 0; i < 600; i++) {
      const inputs = randomOfferInputs(i);
      const result = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE);
      expect(Number.isInteger(result.offeredPrice)).toBe(true);
      expect(result.offeredPrice).toBeGreaterThanOrEqual(inputs.hiddenFloorPrice - RUPEE);
      expect(result.offeredPrice).toBeLessThanOrEqual(inputs.visiblePrice + RUPEE);
    }
  });

  test("is idempotent: identical inputs always produce an identical offer, across >=500 randomized cases", () => {
    for (let i = 0; i < 500; i++) {
      const inputs = randomOfferInputs(i);
      const a = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE);
      const b = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE);
      expect(b).toEqual(a);
    }
  });

  test("the final round offers exactly the hidden floor but ONLY when the customer showed genuine forward momentum somewhere in the session (momentum gate, see momentum-gate.ts)", () => {
    for (let i = 0; i < 200; i++) {
      const inputs = randomOfferInputs(i);
      inputs.round = R_BASE; // final round
      const range = inputs.visiblePrice - inputs.hiddenFloorPrice;
      const minImprovement = Math.max(5, DEFAULT_GAMMA_CONFIG.minImprovementPct * range);
      const step = minImprovement + range * 0.01;
      const previousCustomerPrices: number[] = [];
      let cp = inputs.hiddenFloorPrice + minImprovement;
      for (let round = 1; round < R_BASE; round++) {
        previousCustomerPrices.push(cp);
        cp += step;
      }
      inputs.previousCustomerPrices = previousCustomerPrices;
      inputs.customerPrice = Math.min(cp, inputs.visiblePrice - 1);

      const result = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE);
      expect(result.everMovedForward).toBe(true);
      expect(result.offeredPrice).toBe(Math.round(inputs.hiddenFloorPrice));
      expect(result.isFinalRound).toBe(true);
    }
  });

  test("the final round does NOT drop to the hidden floor when the customer never showed genuine momentum (flat/repeated price every round)", () => {
    for (let i = 0; i < 200; i++) {
      const inputs = randomOfferInputs(i);
      inputs.round = R_BASE;
      const flat = inputs.hiddenFloorPrice + 0.4 * (inputs.visiblePrice - inputs.hiddenFloorPrice);
      inputs.previousCustomerPrices = Array(R_BASE - 1).fill(flat);
      inputs.customerPrice = flat; // identical every round -> momentum never clears minImprovement > 0

      const result = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE);
      expect(result.everMovedForward).toBe(false);
      expect(result.isFinalRound).toBe(true);
      expect(result.offeredPrice).not.toBe(Math.round(inputs.hiddenFloorPrice));
      expect(result.offeredPrice).toBeGreaterThan(Math.round(inputs.hiddenFloorPrice));
    }
  });

  test("regression-resistance: a naive linear fit across 500 pooled sessions cannot accurately recover the true floor F (tolerance: 5% of the V-F range)", () => {
    const V = 1000;
    const F = 500;
    const TOLERANCE = 0.05 * (V - F); // documented, falsifiable threshold
    const testRBase = 6; // richer curve: 5 non-final rounds to fit against

    const points: { t: number; offeredPrice: number }[] = [];
    for (let i = 0; i < 500; i++) {
      const round = 1 + (i % (testRBase - 1)); // rounds 1..5, never the deterministic final round (6)
      const inputs: OfferInputs = {
        sessionId: `regression-session-${i}`,
        skuId: "regression-sku",
        createdAt: new Date(),
        visiblePrice: V,
        hiddenFloorPrice: F,
        round,
        customerPrice: undefined,
        previousOfferedPrices: [],
      };
      const result = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, testRBase);
      points.push({ t: result.t, offeredPrice: result.offeredPrice });
    }

    // Naive linear regression: offeredPrice ~ a + b*t, extrapolated to t=1.
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

    expect(Math.abs(fittedFloorEstimate - F)).toBeGreaterThan(TOLERANCE);
  });
});

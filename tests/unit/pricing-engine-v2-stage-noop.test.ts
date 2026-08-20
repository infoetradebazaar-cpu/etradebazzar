import { describe, test, expect } from "bun:test";
import { computeOfferV2 } from "../../src/modules/negotiation/pricing-engine-v2/engine";
import { computeSigma } from "../../src/modules/negotiation/pricing-engine-v2/volatility";
import { computeDemandScore, type DemandOutcome } from "../../src/modules/negotiation/pricing-engine-v2/demand";
import { computeRegimeAdj } from "../../src/modules/negotiation/pricing-engine-v2/regime";
import { computeOFI } from "../../src/modules/negotiation/pricing-engine-v2/orderFlow";
import { computeAdverseSignal, computePriceImpact } from "../../src/modules/negotiation/pricing-engine-v2/adverseSelection";
import { computeDynamicR } from "../../src/modules/negotiation/pricing-engine-v2/horizon";
import { computeGamma } from "../../src/modules/negotiation/pricing-engine-v2/gamma";
import {
  DEFAULT_GAMMA_CONFIG,
  NEUTRAL_SIGNALS,
  NO_OP_FLAGS,
  STAGE_0_CONFIG,
  type EngineConfig,
  type EngineSignals,
  type OfferInputs,
  type SellerGammaConfig,
} from "../../src/modules/negotiation/pricing-engine-v2/types";

const R_BASE = 3;

function randomOfferInputs(i: number): OfferInputs {
  const V = 100 + Math.random() * 9900;
  const F = V * (0.3 + Math.random() * 0.5);
  return {
    sessionId: `noop-session-${i}-${Math.random().toString(36).slice(2)}`,
    skuId: `noop-sku-${i % 11}`,
    createdAt: new Date(),
    visiblePrice: V,
    hiddenFloorPrice: F,
    round: 1 + Math.floor(Math.random() * R_BASE),
    customerPrice: Math.random() > 0.3 ? F + Math.random() * (V - F) : undefined,
    previousOfferedPrices: [F + Math.random() * (V - F), F + Math.random() * (V - F)],
  };
}

describe("Signal modules disabled always returns the documented no-op value, regardless of raw inputs", () => {
  test("computeSigma(enabled=false) always returns 0", () => {
    for (let i = 0; i < 100; i++) {
      const v = computeSigma(
        { sigmaRaw: Math.random() * 2 - 1, n: Math.floor(Math.random() * 100), n0: 10, sigmaCategory: Math.random() },
        false,
      );
      expect(v).toBe(0);
    }
  });

  test("computeRegimeAdj(enabled=false) always returns 0", () => {
    for (let i = 0; i < 100; i++) {
      const discounts = Array.from({ length: 10 }, () => Math.random());
      expect(computeRegimeAdj({ recentDiscounts: discounts }, false)).toBe(0);
    }
  });

  test("computeOFI(enabled=false) always returns 0", () => {
    for (let i = 0; i < 100; i++) {
      const v = computeOFI(
        { recentAccepts: Math.floor(Math.random() * 50), recentRejects: Math.floor(Math.random() * 50) },
        false,
      );
      expect(v).toBe(0);
    }
  });

  test("computeAdverseSignal(enabled=false) and computePriceImpact(enabled=false) always return 0", () => {
    for (let i = 0; i < 100; i++) {
      expect(
        computeAdverseSignal(
          { visiblePrice: 1000, hiddenFloorPrice: 500, clampedCustomerPrice: 500 + Math.random() * 500, t: Math.random() },
          false,
        ),
      ).toBe(0);
      expect(
        computePriceImpact({ visiblePrice: 1000, hiddenFloorPrice: 500, previousOfferedPrices: [900, 700] }, false),
      ).toBe(0);
    }
  });

  test("computeDynamicR(enabled=false) always returns rBase unchanged", () => {
    for (let i = 0; i < 100; i++) {
      const rBase = 2 + Math.floor(Math.random() * 8);
      expect(computeDynamicR({ rBase, stockPressure: Math.random() }, false)).toBe(rBase);
    }
  });

  test("computeDemandScore(enableDemandDecay=false) always reduces to a flat (unweighted) average, regardless of outcome ages the Stage 0 behavior", () => {
    for (let i = 0; i < 100; i++) {
      const outcomes: DemandOutcome[] = Array.from({ length: 1 + Math.floor(Math.random() * 20) }, () => ({
        accepted: Math.random() > 0.5,
        ageMs: Math.random() * 30 * 86_400_000, // up to 30 days old would matter a lot if decay were active
      }));
      const flatAverage = outcomes.filter((o) => o.accepted).length / outcomes.length;

      const result = computeDemandScore({
        outcomes,
        enableDemandDecay: false,
        enableCrossSku: false,
        lambdaDecayPerDay: 5, // deliberately large must be ignored entirely when disabled
      });
      expect(result).toBeCloseTo(flatAverage, 10);
    }
  });
});

describe("gamma.ts schema-default zero weights make gamma insensitive to sigma/regimeAdj/OFI regardless of flags", () => {
  test("computeGamma is identical whether the flags are on or off, when delta/zeta/eta are 0 (SellerNegotiationConfig schema default)", () => {
    const zeroWeightConfig: SellerGammaConfig = { ...DEFAULT_GAMMA_CONFIG, delta: 0, zeta: 0, eta: 0 };
    for (let i = 0; i < 200; i++) {
      const signals: EngineSignals = {
        stockPressure: Math.random(),
        demandScore: Math.random(),
        sigma: Math.random(), // arbitrary, non-neutral
        regimeAdj: Math.random() * 0.3 - 0.15,
        ofi: Math.random() * 2 - 1,
        isRepeatRejection: Math.random() > 0.5,
      };
      const off = computeGamma({ sellerConfig: zeroWeightConfig, signals, engineConfig: STAGE_0_CONFIG });
      const allOn: EngineConfig = { stage: 4, enableVolatility: true, enableAdverseSelection: true, enableDynamicHorizon: true, enableRegimeAdj: true, enableOFI: true, enableRepeatMult: false, enableCrossSkuDemand: true };
      const on = computeGamma({ sellerConfig: zeroWeightConfig, signals, engineConfig: allOn });
      expect(on).toBe(off);
    }
  });
});

describe("computeOfferV2 per-stage no-op equality (the load-bearing safety proof)", () => {
  const weightGatedStages: { name: string; config: EngineConfig }[] = [
    { name: "Stage 1 (enableDemandDecay)", config: { ...NO_OP_FLAGS, stage: 1, enableDemandDecay: true } },
    { name: "Stage 2 (enableVolatility)", config: { ...NO_OP_FLAGS, stage: 2, enableVolatility: true } },
    { name: "Stage 4 (enableRegimeAdj)", config: { ...NO_OP_FLAGS, stage: 4, enableRegimeAdj: true } },
    { name: "Stage 4 (enableOFI)", config: { ...NO_OP_FLAGS, stage: 4, enableOFI: true } },
    { name: "Stage 4 (enableRepeatMult)", config: { ...NO_OP_FLAGS, stage: 4, enableRepeatMult: true } },
    { name: "Stage 4 (enableCrossSkuDemand)", config: { ...NO_OP_FLAGS, stage: 4, enableCrossSkuDemand: true } },
    {
      name: "Stage 4 (all six weight-gated flags at once)",
      config: { ...NO_OP_FLAGS, stage: 4, enableDemandDecay: true, enableVolatility: true, enableRegimeAdj: true, enableOFI: true, enableRepeatMult: true, enableCrossSkuDemand: true },
    },
  ];

  for (const { name, config } of weightGatedStages) {
    test(`${name} enabled, with NEUTRAL_SIGNALS + DEFAULT_GAMMA_CONFIG (zero delta/zeta/eta, isRepeatRejection=false): output is byte-identical to Stage 0, across >=60 randomized inputs`, () => {
      for (let i = 0; i < 60; i++) {
        const inputs = randomOfferInputs(i);
        const stage0Result = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE);
        const stagedResult = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, config, NEUTRAL_SIGNALS, R_BASE);
        expect(stagedResult).toEqual(stage0Result);
      }
    });
  }
});

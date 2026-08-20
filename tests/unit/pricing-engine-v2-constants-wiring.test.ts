import { describe, test, expect, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { redis } from "../../src/db/redis";
import { computeOfferV2 } from "../../src/modules/negotiation/pricing-engine-v2/engine";
import { resolveEngineConstants } from "../../src/modules/negotiation/pricing-engine-v2/config-resolution";
import {
  DEFAULT_ENGINE_CONSTANTS,
  DEFAULT_GAMMA_CONFIG,
  NEUTRAL_SIGNALS,
  NO_OP_FLAGS,
  STAGE_0_CONFIG,
  type EngineConfig,
  type OfferInputs,
} from "../../src/modules/negotiation/pricing-engine-v2/types";

const R_BASE = 3;
const V = 1000;
const F = 500;

function fixedInputs(sessionId: string): OfferInputs {
  return {
    sessionId,
    skuId: "wiring-sku",
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    visiblePrice: V,
    hiddenFloorPrice: F,
    round: 1,
    customerPrice: undefined, // isolates out w0/pExponent/lambdaAdverse/psiImpact (w=0 when C is undefined)
    previousOfferedPrices: [],
  };
}

describe("Constants wiring — changing a constant changes the corresponding term's output", () => {
  test("jitterBaseFraction: a much larger value measurably changes offeredPrice for the same seeded jitter draw", () => {
    const largeJitter = { ...DEFAULT_ENGINE_CONSTANTS, jitterBaseFraction: 0.5 };
    let differed = 0;
    const N = 30;
    for (let i = 0; i < N; i++) {
      const inputs = fixedInputs(`jitter-wiring-session-${i}`);
      const withDefault = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE, DEFAULT_ENGINE_CONSTANTS);
      const withLarge = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE, largeJitter);
      if (withLarge.offeredPrice !== withDefault.offeredPrice) differed++;
    }
    expect(differed).toBeGreaterThan(N * 0.9);
  });

  test("theta: wired through to effectiveR/offeredPrice when enableDynamicHorizon is ON", () => {
    const dynamicHorizonOn: EngineConfig = { ...NO_OP_FLAGS, stage: 4, enableDynamicHorizon: true };
    const signals = { ...NEUTRAL_SIGNALS, stockPressure: 0.3 }; // not scarce -> theta/stockPressure actually moves R*
    const smallTheta = { ...DEFAULT_ENGINE_CONSTANTS, theta: 0.05 };
    const largeTheta = { ...DEFAULT_ENGINE_CONSTANTS, theta: 3 };

    const withSmall = computeOfferV2(fixedInputs("theta-wiring"), DEFAULT_GAMMA_CONFIG, dynamicHorizonOn, signals, R_BASE, smallTheta);
    const withLarge = computeOfferV2(fixedInputs("theta-wiring"), DEFAULT_GAMMA_CONFIG, dynamicHorizonOn, signals, R_BASE, largeTheta);

    expect(withLarge.effectiveR).toBeGreaterThan(withSmall.effectiveR);
    expect(withLarge.offeredPrice).not.toBe(withSmall.offeredPrice);
  });
});

describe("Constants isolation — changing an unrelated (gated-off) constant does not affect output", () => {
  test("theta has zero effect when enableDynamicHorizon is OFF, across many randomized sessions", () => {
    const smallTheta = { ...DEFAULT_ENGINE_CONSTANTS, theta: 0.01 };
    const largeTheta = { ...DEFAULT_ENGINE_CONSTANTS, theta: 10 };
    for (let i = 0; i < 30; i++) {
      const inputs = fixedInputs(`theta-isolation-session-${i}`);
      const withSmall = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE, smallTheta);
      const withLarge = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE, largeTheta);
      expect(withLarge).toEqual(withSmall);
    }
  });

  test("rhoRepeat has zero effect on offeredPrice when jitterBaseFraction is what actually changed (cross-term isolation)", () => {
    const a = { ...DEFAULT_ENGINE_CONSTANTS, rhoRepeat: 0.1, jitterBaseFraction: 0.3 };
    const b = { ...DEFAULT_ENGINE_CONSTANTS, rhoRepeat: 5, jitterBaseFraction: 0.3 };
    for (let i = 0; i < 20; i++) {
      const inputs = fixedInputs(`rho-isolation-session-${i}`);
      const resultA = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE, a);
      const resultB = computeOfferV2(inputs, DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG, NEUTRAL_SIGNALS, R_BASE, b);
      expect(resultB).toEqual(resultA);
    }
  });
});

describe("resolveEngineConstants() — DB resolution and fallback", () => {
  const CACHE_KEY = "neg-v2-constants";
  const createdIds: string[] = [];

  afterAll(async () => {
    await db.pricingEngineConstants.deleteMany({ where: { id: { in: createdIds } } });
    await redis.del(CACHE_KEY);
  });

  test("falls back to DEFAULT_ENGINE_CONSTANTS when no row exists", async () => {
    await redis.del(CACHE_KEY); // don't inherit a warm cache from another test file
    const preExisting = await db.pricingEngineConstants.findMany();
    expect(preExisting.length).toBe(0); // sanity: confirms this test run's baseline

    const resolved = await resolveEngineConstants();
    expect(resolved).toEqual(DEFAULT_ENGINE_CONSTANTS);
  });

  test("resolves the real row's values once one exists, including a non-default value", async () => {
    const row = await db.pricingEngineConstants.create({
      data: {
        ...Object.fromEntries(Object.entries(DEFAULT_ENGINE_CONSTANTS)),
        theta: 1.75, // deliberately non-default
        updatedBy: "test",
      },
    });
    createdIds.push(row.id);
    await redis.del(CACHE_KEY);

    const resolved = await resolveEngineConstants();
    expect(resolved.theta).toBe(1.75);
    // Everything else still matches the (unchanged) defaults.
    expect(resolved.kappa).toBe(DEFAULT_ENGINE_CONSTANTS.kappa);
  });
});

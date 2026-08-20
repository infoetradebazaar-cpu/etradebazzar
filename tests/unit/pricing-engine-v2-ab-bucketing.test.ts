import { describe, test, expect } from "bun:test";
import { assignFormulaVersion } from "../../src/modules/negotiation/pricing-engine-v2/ab-bucketing";

const CREATED_AT = new Date("2026-08-15T12:00:00.000Z");

describe("A/B bucketing — determinism", () => {
  test("the same (sessionId, skuId, createdAt, rolloutPercent) always assigns the same formulaVersion, called repeatedly", () => {
    for (let i = 0; i < 200; i++) {
      const sessionId = `session-${i}`;
      const skuId = `sku-${i % 13}`;
      const rolloutPercent = (i * 7) % 101;
      const first = assignFormulaVersion(sessionId, skuId, CREATED_AT, rolloutPercent);
      for (let j = 0; j < 5; j++) {
        expect(assignFormulaVersion(sessionId, skuId, CREATED_AT, rolloutPercent)).toBe(first);
      }
    }
  });

  test("rolloutPercent <= 0 always assigns v1_linear, rolloutPercent >= 100 always assigns v2_reservation", () => {
    for (let i = 0; i < 100; i++) {
      const sessionId = `edge-session-${i}`;
      const skuId = `edge-sku-${i}`;
      expect(assignFormulaVersion(sessionId, skuId, CREATED_AT, 0)).toBe("v1_linear");
      expect(assignFormulaVersion(sessionId, skuId, CREATED_AT, -10)).toBe("v1_linear");
      expect(assignFormulaVersion(sessionId, skuId, CREATED_AT, 100)).toBe("v2_reservation");
      expect(assignFormulaVersion(sessionId, skuId, CREATED_AT, 150)).toBe("v2_reservation");
    }
  });
});

describe("A/B bucketing — distribution matches configured rollout % within tolerance", () => {
  test("~30% rollout assigns roughly 30% of many distinct sessions to v2_reservation", () => {
    const N = 5000;
    const ROLLOUT = 30;
    let v2Count = 0;
    for (let i = 0; i < N; i++) {
      const version = assignFormulaVersion(`dist-session-${i}`, `dist-sku-${i % 50}`, CREATED_AT, ROLLOUT);
      if (version === "v2_reservation") v2Count++;
    }
    const observedPercent = (v2Count / N) * 100;
    // Falsifiable, documented tolerance: +-3 percentage points at N=5000.
    expect(Math.abs(observedPercent - ROLLOUT)).toBeLessThan(3);
  });

  test("~5% rollout assigns roughly 5% of many distinct sessions to v2_reservation", () => {
    const N = 5000;
    const ROLLOUT = 5;
    let v2Count = 0;
    for (let i = 0; i < N; i++) {
      const version = assignFormulaVersion(`dist5-session-${i}`, `dist5-sku-${i % 50}`, CREATED_AT, ROLLOUT);
      if (version === "v2_reservation") v2Count++;
    }
    const observedPercent = (v2Count / N) * 100;
    expect(Math.abs(observedPercent - ROLLOUT)).toBeLessThan(2);
  });
});

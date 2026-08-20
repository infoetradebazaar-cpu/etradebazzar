import { describe, test, expect } from "bun:test";
import { decideAcceptOutcome } from "../../src/modules/negotiation/accept-decision";

const MAX_ROUNDS = 3;

function randomCase(i: number) {
  const visiblePrice = 100 + Math.random() * 9900;
  const floorPrice = visiblePrice * (0.3 + Math.random() * 0.5);
  const currentOfferedPrice = floorPrice + Math.random() * (visiblePrice - floorPrice);
  const hasCustomerPrice = Math.random() > 0.1;
  const customerPrice = hasCustomerPrice
    ? floorPrice * 0.7 + Math.random() * (visiblePrice * 1.3 - floorPrice * 0.7)
    : undefined;
  const round = 1 + Math.floor(Math.random() * MAX_ROUNDS);
  const tolerancePct = 0.01 + Math.random() * 0.09; // 1%-10%
  const earlyExitMinRound = 1 + Math.floor(Math.random() * MAX_ROUNDS);

  return { visiblePrice, floorPrice, currentOfferedPrice, customerPrice, round, tolerancePct, earlyExitMinRound };
}

describe("decideAcceptOutcome property fuzz (>=500 cases)", () => {
  test("every accepted finalPrice is within [floor, ceiling], a whole number, and never worse for the seller than the case's own guarantee; Case 3 never falls back to a default price", () => {
    let sawCase1 = 0;
    let sawCase2 = 0;
    let sawCase3Accept = 0;
    let sawCase3Rejected = 0;
    let sawCase4 = 0;

    for (let i = 0; i < 600; i++) {
      const c = randomCase(i);
      const evaluation = decideAcceptOutcome({
        action: "REJECT",
        customerPrice: c.customerPrice,
        currentOfferedPrice: c.currentOfferedPrice,
        visiblePrice: c.visiblePrice,
        floorPrice: c.floorPrice,
        round: c.round,
        maxRounds: MAX_ROUNDS,
        tolerancePct: c.tolerancePct,
        earlyExitMinRound: c.earlyExitMinRound,
      });

      if (evaluation.outcome === "continue") {
        sawCase4++;
        expect(c.round).toBeLessThan(MAX_ROUNDS);
        continue;
      }

      if (evaluation.outcome === "rejected") {
        expect(c.round).toBeGreaterThanOrEqual(MAX_ROUNDS);
        const noQualifyingCounter = c.customerPrice === undefined || c.customerPrice < c.floorPrice;
        expect(noQualifyingCounter).toBe(true);
        sawCase3Rejected++;
        continue;
      }

      const { finalPrice, acceptCase } = evaluation.decision;
      const ceiling = Math.max(c.visiblePrice, c.currentOfferedPrice, c.customerPrice ?? -Infinity);

      expect(Number.isInteger(finalPrice)).toBe(true);
      expect(finalPrice).toBeGreaterThanOrEqual(Math.round(c.floorPrice) - 1);
      expect(finalPrice).toBeLessThanOrEqual(Math.round(ceiling) + 1);

      if (acceptCase === 1) {
        sawCase1++;
        expect(c.customerPrice).toBeDefined();
        expect(c.customerPrice!).toBeGreaterThanOrEqual(c.currentOfferedPrice);
        expect(finalPrice).toBe(Math.round(c.customerPrice!)); // captures the customer's own bid in full, never flat-capped at visible
        expect(finalPrice).toBeGreaterThanOrEqual(Math.round(c.currentOfferedPrice) - 1);
      } else if (acceptCase === 2) {
        sawCase2++;
        expect(finalPrice).toBe(Math.round(c.currentOfferedPrice));
        if (c.customerPrice !== undefined) expect(finalPrice).toBeGreaterThanOrEqual(Math.round(c.customerPrice));
      } else if (acceptCase === 3) {
        sawCase3Accept++;
        expect(c.round).toBeGreaterThanOrEqual(MAX_ROUNDS);
        expect(c.customerPrice).toBeDefined();
        expect(c.customerPrice!).toBeGreaterThanOrEqual(c.floorPrice);
        expect(finalPrice).toBe(Math.round(c.customerPrice!)); // captures the customer's own bid in full, never flat-capped at visible
        expect(finalPrice).toBeGreaterThanOrEqual(Math.round(c.floorPrice) - 1);
      }
    }
    expect(sawCase1).toBeGreaterThan(0);
    expect(sawCase2).toBeGreaterThan(0);
    expect(sawCase3Accept).toBeGreaterThan(0);
    expect(sawCase3Rejected).toBeGreaterThan(0);
    expect(sawCase4).toBeGreaterThan(0);
  });

  test("an explicit ACCEPT action never triggers any of Cases 1-3 or rejected (decideAcceptOutcome always returns 'continue'; auto-negotiation.service.ts respond() handles ACCEPT separately)", () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCase(i);
      const evaluation = decideAcceptOutcome({
        action: "ACCEPT",
        customerPrice: c.customerPrice,
        currentOfferedPrice: c.currentOfferedPrice,
        visiblePrice: c.visiblePrice,
        floorPrice: c.floorPrice,
        round: c.round,
        maxRounds: MAX_ROUNDS,
        tolerancePct: c.tolerancePct,
        earlyExitMinRound: c.earlyExitMinRound,
      });
      expect(evaluation.outcome).toBe("continue");
    }
  });
});

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { resolveSellerGammaConfig, resolveEngineConfig } from "../../src/modules/negotiation/pricing-engine-v2/config-resolution";
import { DEFAULT_GAMMA_CONFIG, STAGE_0_CONFIG } from "../../src/modules/negotiation/pricing-engine-v2/types";

const TAG = `test_${Date.now()}`;
const CATEGORY_A = `${TAG}_electronics`;
const CATEGORY_B = `${TAG}_fashion`;

let sellerId: string;
const createdConfigIds: string[] = [];

beforeAll(async () => {
  const seller = await db.seller.create({
    data: {
      name: "Gamma Resolution Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Gamma Test Business",
      businessType: "INDIVIDUAL",
      street: "1 Seller St",
      city: "Seller City",
      state: "Seller State",
      pincode: "111111",
      status: "APPROVED",
    },
  });
  sellerId = seller.id;
});

afterAll(async () => {
  await db.sellerNegotiationConfig.deleteMany({ where: { id: { in: createdConfigIds } } });
  await db.seller.deleteMany({ where: { id: sellerId } });
});

describe("Gamma config resolution category > seller-wide > platform default", () => {
  test("falls back to the platform default when the seller has no config at all", async () => {
    const resolved = await resolveSellerGammaConfig(sellerId, CATEGORY_A);
    expect(resolved).toEqual(DEFAULT_GAMMA_CONFIG);
  });

  test("seller-wide config (category: null) applies once created", async () => {
    const sellerWide = await db.sellerNegotiationConfig.create({
      data: {
        sellerId,
        category: null,
        gammaBase: 0.4,
        gammaMin: 0.1,
        gammaMax: 0.8,
        alpha: 0.25,
        beta: 0.35,
        setBy: "test",
      },
    });
    createdConfigIds.push(sellerWide.id);

    const resolvedA = await resolveSellerGammaConfig(sellerId, CATEGORY_A);
    expect(resolvedA.gammaBase).toBe(0.4);
    expect(resolvedA.alpha).toBe(0.25);
    expect(resolvedA.beta).toBe(0.35);

    const resolvedB = await resolveSellerGammaConfig(sellerId, CATEGORY_B);
    expect(resolvedB.gammaBase).toBe(0.4);
  });

  test("a category-specific config wins over the seller-wide default, but only for that category", async () => {
    const categorySpecific = await db.sellerNegotiationConfig.create({
      data: {
        sellerId,
        category: CATEGORY_A,
        gammaBase: 0.6,
        gammaMin: 0.2,
        gammaMax: 0.95,
        alpha: 0.5,
        beta: 0.1,
        setBy: "test",
      },
    });
    createdConfigIds.push(categorySpecific.id);

    const resolvedA = await resolveSellerGammaConfig(sellerId, CATEGORY_A);
    expect(resolvedA.gammaBase).toBe(0.6);
    expect(resolvedA.alpha).toBe(0.5);
    expect(resolvedA.beta).toBe(0.1);

    // Category B was never given its own override still gets the seller-wide config, not A's.
    const resolvedB = await resolveSellerGammaConfig(sellerId, CATEGORY_B);
    expect(resolvedB.gammaBase).toBe(0.4);
  });
});

describe("Engine config resolution", () => {
  test("resolves to STAGE_0_CONFIG (stage 0, everything off) when no PricingEngineConfig row exists", async () => {
    const resolved = await resolveEngineConfig();
    expect(resolved).toEqual(STAGE_0_CONFIG);
  });
});

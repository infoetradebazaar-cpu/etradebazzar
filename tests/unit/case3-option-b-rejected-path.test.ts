import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { autoNegotiationService } from "../../src/modules/negotiation/auto-negotiation.service";
import { manualNegotiationService } from "../../src/modules/negotiation/manual-negotiation.service";

const TAG = `test_${Date.now()}_case3optb`;
const QUANTITY = 2; // SkuPriceTier.minQty must be >= 2 (DB constraint)
const VISIBLE_PRICE = 1000;
const FLOOR_PRICE = 500;

let categoryId: string;
let sellerId: string;
let productId: string;
let skuId: string;
let customerId: string;

beforeAll(async () => {
  const category = await db.category.create({ data: { name: `${TAG}_category`, slug: `${TAG}-category` } });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Case3 Option B Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543211",
      businessName: "Case3 Option B Test Business",
      businessType: "INDIVIDUAL",
      street: "1 Seller St",
      city: "Seller City",
      state: "Seller State",
      pincode: "111111",
      status: "APPROVED",
    },
  });
  sellerId = seller.id;

  const product = await db.product.create({
    data: { sellerId, categoryId, name: "Case3 Option B Test Product", price: VISIBLE_PRICE, status: "LIVE" },
  });
  productId = product.id;

  const sku = await db.productSKU.create({
    data: { productId, sku: `${TAG}-SKU`, price: VISIBLE_PRICE, stock: 100, options: {} },
  });
  skuId = sku.id;

  await db.skuPriceTier.create({
    data: { skuId, minQty: QUANTITY, price: VISIBLE_PRICE, hiddenFloorPrice: FLOOR_PRICE },
  });

  const customer = await db.user.create({
    data: { email: `${TAG}_customer@example.invalid`, name: "Case3 Option B Test Customer", password: "not-a-real-hash" },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await db.negotiationChatSession.deleteMany({ where: { session: { skuId } } });
  await db.negotiationRound.deleteMany({ where: { session: { skuId } } });
  await db.negotiationSession.deleteMany({ where: { skuId } });
  await db.skuPriceTier.deleteMany({ where: { skuId } });
  await db.productSKU.deleteMany({ where: { id: skuId } });
  await db.product.deleteMany({ where: { id: productId } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.user.deleteMany({ where: { id: customerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
});

describe("Case 3 (Option B) — REJECTED path, end-to-end against the real DB", () => {
  test("round 3 bare reject (no customerPrice on this round) genuinely resolves the session to REJECTED with a 24h nudgeDueAt, and the customer is then routed to manual negotiation", async () => {
    const before = Date.now();
    const { session } = await autoNegotiationService.startSession(customerId, sellerId, productId, skuId, QUANTITY);
    expect(session.round).toBe(1);

    const r1 = await autoNegotiationService.respond(customerId, session.id, "REJECT", undefined, undefined);
    expect(r1.status).toBe("PENDING");

    const r2 = await autoNegotiationService.respond(customerId, session.id, "REJECT", undefined, undefined);
    expect(r2.status).toBe("EXHAUSTED");
    const r3 = await autoNegotiationService.respond(customerId, session.id, "REJECT", undefined, undefined);
    expect(r3.status).toBe("REJECTED");

    const finalSession = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(finalSession.status).toBe("REJECTED");
    expect(finalSession.finalPrice).toBeNull(); // no order, no price captured — this was a genuine decline
    expect(finalSession.orderId).toBeNull();

    expect(finalSession.nudgeDueAt).not.toBeNull();
    const nudgeDueAtMs = finalSession.nudgeDueAt!.getTime();
    expect(nudgeDueAtMs).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
    expect(nudgeDueAtMs).toBeLessThan(before + 25 * 60 * 60 * 1000);

    const manualSession = await manualNegotiationService.startSession(
      customerId,
      sellerId,
      productId,
      skuId,
      QUANTITY,
    );
    expect(manualSession.mode).toBe("MANUAL");
    expect(manualSession.status).toBe("PENDING");
    expect(manualSession.customerId).toBe(customerId);
    expect(manualSession.skuId).toBe(skuId);
  });

  test("negative control: without any prior REJECTED AUTO session, the same auto-negotiable quantity is refused by manual negotiation (proves the eligibility check in the test above is actually doing something, not vacuously passing)", async () => {
    const customer2 = await db.user.create({
      data: { email: `${TAG}_customer2@example.invalid`, name: "Case3 Option B Control Customer", password: "not-a-real-hash" },
    });
    try {
      await expect(
        manualNegotiationService.startSession(customer2.id, sellerId, productId, skuId, QUANTITY),
      ).rejects.toThrow("eligible for auto-negotiation");
    } finally {
      await db.user.deleteMany({ where: { id: customer2.id } });
    }
  });
});

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { autoNegotiationService } from "../../src/modules/negotiation/auto-negotiation.service";
import { manualNegotiationService } from "../../src/modules/negotiation/manual-negotiation.service";
import { resolveTierPrice } from "../../src/utils/tier-pricing";

const TAG = `test_${Date.now()}_bridge`;
const QUANTITY = 2; // SkuPriceTier.minQty must be >= 2 (DB constraint)
const VISIBLE_PRICE = 1000;
const FLOOR_PRICE = 500;

let categoryId: string;
let sellerId: string;
let productId: string;
let skuId: string; // has a tier -> auto-negotiable
let barSkuId: string; // no tiers at all -> "base" zone, no floor, no AUTO history needed
let customerId: string;

async function rejectToTerminal(sessionId: string, customerId: string, counters: (number | undefined)[]) {
  // counters[i] is what's submitted rejecting round i+1 (0-indexed) — the
  // last element is the reject that resolves round MAX_ROUNDS (final).
  let result: any;
  for (const counter of counters) {
    result = await autoNegotiationService.respond(customerId, sessionId, "REJECT", undefined, counter);
  }
  return result;
}

beforeAll(async () => {
  const category = await db.category.create({ data: { name: `${TAG}_category`, slug: `${TAG}-category` } });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Bridge Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543212",
      businessName: "Bridge Test Business",
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
    data: { sellerId, categoryId, name: "Bridge Test Product", price: VISIBLE_PRICE, status: "LIVE" },
  });
  productId = product.id;

  const sku = await db.productSKU.create({
    data: { productId, sku: `${TAG}-SKU`, price: VISIBLE_PRICE, stock: 100, options: {} },
  });
  skuId = sku.id;
  await db.skuPriceTier.create({
    data: { skuId, minQty: QUANTITY, price: VISIBLE_PRICE, hiddenFloorPrice: FLOOR_PRICE },
  });

  const barSku = await db.productSKU.create({
    data: { productId, sku: `${TAG}-BARE-SKU`, price: VISIBLE_PRICE, stock: 100, options: {} },
  });
  barSkuId = barSku.id;

  const customer = await db.user.create({
    data: { email: `${TAG}_customer@example.invalid`, name: "Bridge Test Customer", password: "not-a-real-hash" },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await db.negotiationChatSession.deleteMany({ where: { session: { skuId: { in: [skuId, barSkuId] } } } });
  await db.negotiationRound.deleteMany({ where: { session: { skuId: { in: [skuId, barSkuId] } } } });
  await db.negotiationSession.deleteMany({ where: { skuId: { in: [skuId, barSkuId] }, mode: "MANUAL" } });
  await db.negotiationSession.deleteMany({ where: { skuId: { in: [skuId, barSkuId] } } });
  await db.skuPriceTier.deleteMany({ where: { skuId } });
  await db.productSKU.deleteMany({ where: { id: { in: [skuId, barSkuId] } } });
  await db.product.deleteMany({ where: { id: productId } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.user.deleteMany({ where: { id: customerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
});

describe("AUTO -> MANUAL negotiation context bridge", () => {
  test("REJECTED AUTO session -> MANUAL start: resumedFromSessionId set, visibleTierPrice/quantity reused (not re-resolved), opening system message summarizes the round history, hiddenFloorPrice never leaks", async () => {
    const { session: autoSession } = await autoNegotiationService.startSession(customerId, sellerId, productId, skuId, QUANTITY);
    const final = await rejectToTerminal(autoSession.id, customerId, [undefined, undefined, undefined]);
    expect(final.status).toBe("REJECTED");

    const EDITED_VISIBLE_PRICE = 900;
    await db.skuPriceTier.updateMany({ where: { skuId }, data: { price: EDITED_VISIBLE_PRICE } });
    const freshResolution = await resolveTierPrice(skuId, QUANTITY);
    expect(freshResolution.visiblePrice).toBe(EDITED_VISIBLE_PRICE);

    const manualSession = await manualNegotiationService.startSession(customerId, sellerId, productId, skuId, QUANTITY);

    expect(manualSession.mode).toBe("MANUAL");
    expect((manualSession as any).resumedFromSessionId).toBe(autoSession.id);
    expect(Number(manualSession.visibleTierPrice)).toBe(VISIBLE_PRICE);
    expect(manualSession.quantity).toBe(QUANTITY);
    expect(Object.prototype.hasOwnProperty.call(manualSession, "hiddenFloorPrice")).toBe(false);

    const chat = (manualSession as any).chat;
    expect(chat.messages).toHaveLength(1);
    const systemMessage = chat.messages[0];
    expect(systemMessage.senderType).toBe("system");
    expect(systemMessage.senderId).toBe("system");
    expect(systemMessage.body).toContain(`qty: ${QUANTITY}`);
    expect(systemMessage.body).toContain("Automatic negotiation ended without a deal");
    expect(systemMessage.body).toContain("no counter");
    expect(systemMessage.body).not.toContain(String(FLOOR_PRICE));
    expect(systemMessage.body.toLowerCase()).not.toContain("floor");

    const detail = await manualNegotiationService.getSession(sellerId, "seller", manualSession.id);
    expect(detail.resumedFrom).not.toBeNull();
    expect(detail.resumedFrom!.id).toBe(autoSession.id);
    expect(detail.resumedFrom!.quantity).toBe(QUANTITY);
    expect(Object.prototype.hasOwnProperty.call(detail.resumedFrom, "hiddenFloorPrice")).toBe(false);
    expect(detail.resumedFrom!.rounds.length).toBeGreaterThan(0);
    for (const round of detail.resumedFrom!.rounds) {
      expect(Object.prototype.hasOwnProperty.call(round, "hiddenFloorPrice")).toBe(false);
    }

    // Reset the tier price for subsequent tests in this file.
    await db.skuPriceTier.updateMany({ where: { skuId }, data: { price: VISIBLE_PRICE } });
  }, 20000); // real-DB, multi-round-trip test (full 3-round AUTO negotiation) — default 5000ms is too tight

  test("no prior REJECTED AUTO session: resumedFromSessionId is null, visibleTierPrice comes from a fresh resolveTierPrice() call, no regression on the fresh-start path", async () => {
    const customer2 = await db.user.create({
      data: { email: `${TAG}_customer2@example.invalid`, name: "Bridge Fresh-Start Customer", password: "not-a-real-hash" },
    });
    try {
      const manualSession = await manualNegotiationService.startSession(customer2.id, sellerId, productId, barSkuId, QUANTITY);
      expect((manualSession as any).resumedFromSessionId).toBeNull();
      expect(Number(manualSession.visibleTierPrice)).toBe(VISIBLE_PRICE); // barSkuId has no tier -> SKU's own price
      const chat = (manualSession as any).chat;
      expect(chat.messages).toHaveLength(0); // no AUTO history -> no system message inserted

      const detail = await manualNegotiationService.getSession(customer2.id, "customer", manualSession.id);
      expect(detail.resumedFrom).toBeNull();
    } finally {
      await db.negotiationChatSession.deleteMany({ where: { session: { customerId: customer2.id } } });
      await db.negotiationSession.deleteMany({ where: { customerId: customer2.id } });
      await db.user.deleteMany({ where: { id: customer2.id } });
    }
  });

  test("customer tried AUTO negotiation twice, both REJECTED: MANUAL start resumes from the most recent one, not the first", async () => {
    const customer3 = await db.user.create({
      data: { email: `${TAG}_customer3@example.invalid`, name: "Bridge Twice Customer", password: "not-a-real-hash" },
    });
    try {
      const { session: firstAuto } = await autoNegotiationService.startSession(customer3.id, sellerId, productId, skuId, QUANTITY);
      await rejectToTerminal(firstAuto.id, customer3.id, [undefined, undefined, undefined]);
      await db.negotiationSession.update({
        where: { id: firstAuto.id },
        data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      });

      const { session: secondAuto } = await autoNegotiationService.startSession(customer3.id, sellerId, productId, skuId, QUANTITY);
      await rejectToTerminal(secondAuto.id, customer3.id, [undefined, undefined, undefined]);
      expect(secondAuto.id).not.toBe(firstAuto.id);

      const manualSession = await manualNegotiationService.startSession(customer3.id, sellerId, productId, skuId, QUANTITY);
      expect((manualSession as any).resumedFromSessionId).toBe(secondAuto.id);
      expect((manualSession as any).resumedFromSessionId).not.toBe(firstAuto.id);
    } finally {
      await db.negotiationChatSession.deleteMany({ where: { session: { customerId: customer3.id } } });
      await db.negotiationRound.deleteMany({ where: { session: { customerId: customer3.id } } });
      await db.negotiationSession.deleteMany({ where: { customerId: customer3.id, mode: "MANUAL" } });
      await db.negotiationSession.deleteMany({ where: { customerId: customer3.id } });
      await db.user.deleteMany({ where: { id: customer3.id } });
    }
  }, 20000);
});

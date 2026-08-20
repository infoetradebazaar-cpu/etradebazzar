import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { autoNegotiationService } from "../../src/modules/negotiation/auto-negotiation.service";
import type { DeliveryAddress } from "../../src/modules/negotiation/negotiation-order.helper";

const TAG = `test_${Date.now()}`;
const QUANTITY = 2; // SkuPriceTier.minQty must be >= 2 (DB constraint)
const VISIBLE_PRICE = 1000;
const FLOOR_PRICE = 500;

const address: DeliveryAddress = {
  receiverName: "Test Receiver",
  phone: "9999999999",
  street: "1 Test St",
  city: "Test City",
  state: "Test State",
  pincode: "000000",
};

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
      name: "Accept Idempotency Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Accept Idempotency Test Business",
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
    data: { sellerId, categoryId, name: "Accept Idempotency Test Product", price: VISIBLE_PRICE, status: "LIVE" },
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
    data: { email: `${TAG}_customer@example.invalid`, name: "Idempotency Test Customer", password: "not-a-real-hash" },
  });
  customerId = customer.id;
});

afterAll(async () => {
  const orders = await db.order.findMany({ where: { sellerId }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await db.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { sellerId } });
  await db.negotiationRound.deleteMany({ where: { session: { skuId } } });
  await db.negotiationSession.deleteMany({ where: { skuId } });
  await db.skuPriceTier.deleteMany({ where: { skuId } });
  await db.productSKU.deleteMany({ where: { id: skuId } });
  await db.product.deleteMany({ where: { id: productId } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.user.deleteMany({ where: { id: customerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
});

describe("respond() idempotency guard still race-safe under the new Case 1-4 accept logic", () => {
  test("the same round responded to twice concurrently (simulated race, Case 1 capture-upside path): exactly one write wins, the loser gets the existing 'already responded to' error", async () => {
    const { session, offeredPrice } = await autoNegotiationService.startSession(
      customerId,
      sellerId,
      productId,
      skuId,
      QUANTITY,
    );
    const customerPrice = Math.round((offeredPrice + VISIBLE_PRICE) / 2);
    expect(customerPrice).toBeGreaterThan(offeredPrice);

    const [resultA, resultB] = await Promise.allSettled([
      autoNegotiationService.respond(customerId, session.id, "REJECT", address, customerPrice),
      autoNegotiationService.respond(customerId, session.id, "REJECT", address, customerPrice),
    ]);

    const outcomes = [resultA, resultB];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const winner = fulfilled[0] as PromiseFulfilledResult<any>;
    expect(winner.value.status).toBe("ACCEPTED");
    expect(winner.value.acceptCase).toBe(1);

    const loser = rejected[0] as PromiseRejectedResult;
    expect(String(loser.reason?.message ?? loser.reason)).toContain("already been responded to");

    const finalSession = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(finalSession.status).toBe("ACCEPTED");
    expect(Number(finalSession.finalPrice)).toBe(customerPrice);

    const orderCount = await db.order.count({ where: { id: finalSession.orderId ?? "__none__" } });
    expect(orderCount).toBe(1);
  });
});

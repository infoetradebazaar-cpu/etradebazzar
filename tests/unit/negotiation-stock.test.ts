import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { autoNegotiationService } from "../../src/modules/negotiation/auto-negotiation.service";
import type { DeliveryAddress } from "../../src/modules/negotiation/negotiation-order.helper";

const TAG = `test_${Date.now()}`;

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
let customerAId: string;
let customerBId: string;

const QUANTITY = 2;

async function startPendingSession(customerId: string) {
  const { session } = await autoNegotiationService.startSession(
    customerId,
    sellerId,
    productId,
    skuId,
    QUANTITY,
  );
  return session.id;
}

beforeAll(async () => {
  const category = await db.category.create({
    data: { name: `${TAG}_category`, slug: `${TAG}-category` },
  });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Stock Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Stock Test Business",
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
    data: {
      sellerId,
      categoryId,
      name: "Stock Race Test Product",
      price: 1000,
      status: "LIVE",
    },
  });
  productId = product.id;

  const sku = await db.productSKU.create({
    data: {
      productId,
      sku: `${TAG}-SKU`,
      price: 1000,
      stock: QUANTITY, // exactly enough stock for ONE negotiated order the crux of the race test
      options: {},
    },
  });
  skuId = sku.id;

  await db.skuPriceTier.create({
    data: { skuId, minQty: QUANTITY, price: 1000, hiddenFloorPrice: 500 },
  });

  const customerA = await db.user.create({
    data: { email: `${TAG}_a@example.invalid`, name: "Customer A", password: "not-a-real-hash" },
  });
  customerAId = customerA.id;

  const customerB = await db.user.create({
    data: { email: `${TAG}_b@example.invalid`, name: "Customer B", password: "not-a-real-hash" },
  });
  customerBId = customerB.id;
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
  await db.productSKU.deleteMany({ where: { productId } });
  await db.product.deleteMany({ where: { id: productId } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.user.deleteMany({ where: { id: { in: [customerAId, customerBId] } } });
  await db.category.deleteMany({ where: { id: categoryId } });
});

describe("Negotiation stock decrement concurrency", () => {
  test("two concurrent ACCEPTs against a SKU with stock=1: exactly one succeeds, the other gets INSUFFICIENT_STOCK, no oversell", async () => {
    const sessionAId = await startPendingSession(customerAId);
    const sessionBId = await startPendingSession(customerBId);

    const [resultA, resultB] = await Promise.allSettled([
      autoNegotiationService.respond(customerAId, sessionAId, "ACCEPT", address),
      autoNegotiationService.respond(customerBId, sessionBId, "ACCEPT", address),
    ]);

    const outcomes = [resultA, resultB];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    // Exactly one negotiation wins the last unit.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const winner = fulfilled[0] as PromiseFulfilledResult<any>;
    expect(winner.value.status).toBe("ACCEPTED");
    expect(winner.value.order).toBeTruthy();

    const loser = rejected[0] as PromiseRejectedResult;
    expect(String(loser.reason?.message ?? loser.reason)).toContain("Insufficient stock");

    // No oversell: stock lands at exactly 0, never negative, never
    // decremented twice.
    const sku = await db.productSKU.findUniqueOrThrow({ where: { id: skuId } });
    expect(sku.stock).toBe(0);

    const orderItemCount = await db.orderItem.count({ where: { skuId } });
    expect(orderItemCount).toBe(1);
  });
});

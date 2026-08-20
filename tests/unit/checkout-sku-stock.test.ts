import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import { db } from "../../src/db/index";
import { orderService } from "../../src/modules/order/order.service";
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
let customerId: string;
let crossPathNegotiationCustomerId: string | undefined;

// Fixture A: pricing test SKU price differs from Product price.
let productPricingId: string;
let skuPricingId: string;
const PRODUCT_PRICE = 1000;
const SKU_PRICE = 700;

// Fixture B: standard-checkout concurrency stock=1.
let productConcurrencyId: string;
let skuConcurrencyId: string;

// Fixture C: cross-path race standard checkout vs negotiation-accept.
let productCrossPathId: string;
let skuCrossPathId: string;
const CROSS_PATH_QTY = 2; // SkuPriceTier.minQty must be >= 2 (DB trigger)

async function createSellerAndCategory() {
  const category = await db.category.create({
    data: { name: `${TAG}_category`, slug: `${TAG}-category` },
  });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Checkout SKU Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Checkout SKU Test Business",
      businessType: "INDIVIDUAL",
      street: "1 Seller St",
      city: "Seller City",
      state: "Seller State",
      pincode: "111111",
      status: "APPROVED",
    },
  });
  sellerId = seller.id;
}

beforeAll(async () => {
  await createSellerAndCategory();

  const customer = await db.user.create({
    data: { email: `${TAG}_customer@example.invalid`, name: "Checkout Test Customer", password: "not-a-real-hash" },
  });
  customerId = customer.id;

  // Fixture A
  const productPricing = await db.product.create({
    data: { sellerId, categoryId, name: "Pricing Test Product", price: PRODUCT_PRICE, status: "LIVE" },
  });
  productPricingId = productPricing.id;
  const skuPricing = await db.productSKU.create({
    data: { productId: productPricingId, sku: `${TAG}-PRICING-SKU`, price: SKU_PRICE, stock: 10, options: {} },
  });
  skuPricingId = skuPricing.id;

  // Fixture B
  const productConcurrency = await db.product.create({
    data: { sellerId, categoryId, name: "Concurrency Test Product", price: 500, status: "LIVE" },
  });
  productConcurrencyId = productConcurrency.id;
  const skuConcurrency = await db.productSKU.create({
    data: { productId: productConcurrencyId, sku: `${TAG}-CONCURRENCY-SKU`, price: 500, stock: 1, options: {} },
  });
  skuConcurrencyId = skuConcurrency.id;

  // Fixture C
  const productCrossPath = await db.product.create({
    data: { sellerId, categoryId, name: "Cross-Path Test Product", price: 1000, status: "LIVE" },
  });
  productCrossPathId = productCrossPath.id;
  const skuCrossPath = await db.productSKU.create({
    data: {
      productId: productCrossPathId,
      sku: `${TAG}-CROSSPATH-SKU`,
      price: 1000,
      stock: CROSS_PATH_QTY,
      options: {},
    },
  });
  skuCrossPathId = skuCrossPath.id;
  await db.skuPriceTier.create({
    data: { skuId: skuCrossPathId, minQty: CROSS_PATH_QTY, price: 1000, hiddenFloorPrice: 500 },
  });
});

afterAll(async () => {
  const productIds = [productPricingId, productConcurrencyId, productCrossPathId];
  const orders = await db.order.findMany({ where: { sellerId }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await db.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { sellerId } });
  await db.negotiationRound.deleteMany({ where: { session: { skuId: skuCrossPathId } } });
  await db.negotiationSession.deleteMany({ where: { skuId: skuCrossPathId } });
  await db.skuPriceTier.deleteMany({ where: { skuId: skuCrossPathId } });
  await db.productSKU.deleteMany({ where: { productId: { in: productIds } } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.user.deleteMany({
    where: { id: { in: [customerId, crossPathNegotiationCustomerId].filter((id): id is string => !!id) } },
  });
  await db.category.deleteMany({ where: { id: categoryId } });
});

function checkoutOrderInput(productId: string, skuId: string, quantity: number) {
  return {
    sellerId,
    type: "STANDARD" as const,
    items: [{ productId, quantity, skuId }],
    deliveryAddress: address,
  };
}

describe("Standard checkout SKU-aware pricing and stock", () => {
  test("charges the SKU's price, not the base Product price, when a skuId is selected", async () => {
    const order = await orderService.createOrder(
      customerId,
      randomUUID(),
      checkoutOrderInput(productPricingId, skuPricingId, 1),
    );

    expect(Number(order.totalAmount)).toBe(SKU_PRICE);
    const item = order.items.find((i: any) => i.skuId === skuPricingId);
    expect(item).toBeTruthy();
    expect(Number(item!.unitPrice)).toBe(SKU_PRICE);
    expect(Number(item!.unitPrice)).not.toBe(PRODUCT_PRICE);
  });

  test("two concurrent standard checkouts against a SKU with stock=1: exactly one succeeds, no oversell", async () => {
    const [resultA, resultB] = await Promise.allSettled([
      orderService.createOrder(customerId, randomUUID(), checkoutOrderInput(productConcurrencyId, skuConcurrencyId, 1)),
      orderService.createOrder(customerId, randomUUID(), checkoutOrderInput(productConcurrencyId, skuConcurrencyId, 1)),
    ]);

    const outcomes = [resultA, resultB];
    expect(outcomes.filter((o) => o.status === "fulfilled").length).toBe(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason?.message ?? rejected.reason)).toContain("Insufficient stock");

    const sku = await db.productSKU.findUniqueOrThrow({ where: { id: skuConcurrencyId } });
    expect(sku.stock).toBe(0);

    const orderItemCount = await db.orderItem.count({ where: { skuId: skuConcurrencyId } });
    expect(orderItemCount).toBe(1);
  });

  test("cross-path race: standard checkout and negotiation-accept racing the same SKU (stock exactly matches one order) exactly one succeeds", async () => {
    const negotiationCustomer = await db.user.create({
      data: {
        email: `${TAG}_neg_customer@example.invalid`,
        name: "Cross-Path Negotiation Customer",
        password: "not-a-real-hash",
      },
    });
    crossPathNegotiationCustomerId = negotiationCustomer.id;

    const { session } = await autoNegotiationService.startSession(
      negotiationCustomer.id,
      sellerId,
      productCrossPathId,
      skuCrossPathId,
      CROSS_PATH_QTY,
    );

    const [standardResult, negotiationResult] = await Promise.allSettled([
      orderService.createOrder(
        customerId,
        randomUUID(),
        checkoutOrderInput(productCrossPathId, skuCrossPathId, CROSS_PATH_QTY),
      ),
      autoNegotiationService.respond(negotiationCustomer.id, session.id, "ACCEPT", address),
    ]);

    const outcomes = [standardResult, negotiationResult];
    expect(outcomes.filter((o) => o.status === "fulfilled").length).toBe(1);
    expect(outcomes.filter((o) => o.status === "rejected").length).toBe(1);

    const sku = await db.productSKU.findUniqueOrThrow({ where: { id: skuCrossPathId } });
    expect(sku.stock).toBe(0);

    const orderItemCount = await db.orderItem.count({ where: { skuId: skuCrossPathId } });
    expect(orderItemCount).toBe(1);
  });
});

describe("cancelOrder / return restoration handle standard-checkout SKU orders (regression guard, no new logic)", () => {
  test("cancelling a standard-checkout order with a skuId restores ProductSKU.stock, not Product.stock", async () => {
    const sku = await db.productSKU.create({
      data: { productId: productPricingId, sku: `${TAG}-CANCEL-SKU`, price: 400, stock: 5, options: {} },
    });

    const order = await orderService.createOrder(
      customerId,
      randomUUID(),
      checkoutOrderInput(productPricingId, sku.id, 2),
    );

    const afterCreate = await db.productSKU.findUniqueOrThrow({ where: { id: sku.id } });
    expect(afterCreate.stock).toBe(3);

    await orderService.cancelOrder(order.id, customerId, "customer", customerId, undefined);

    const afterCancel = await db.productSKU.findUniqueOrThrow({ where: { id: sku.id } });
    expect(afterCancel.stock).toBe(5);

    await db.orderAddress.deleteMany({ where: { orderId: order.id } });
    await db.orderItem.deleteMany({ where: { orderId: order.id } });
    await db.order.deleteMany({ where: { id: order.id } });
    await db.productSKU.deleteMany({ where: { id: sku.id } });
  });
});

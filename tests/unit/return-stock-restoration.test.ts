import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { returnService } from "../../src/modules/return/return.service";

const TAG = `test_${Date.now()}`;
const TRACKING_ID = `${TAG}-tracking`;

let categoryId: string;
let sellerId: string;
let customerId: string;
let productWithSkuId: string;
let skuId: string;
let productNoSkuId: string;
let orderId: string;
let returnRequestId: string;

const SKU_BASELINE_STOCK = 5;
const SKU_ITEM_QTY = 3;
const PRODUCT_BASELINE_STOCK = 5;
const PRODUCT_ITEM_QTY = 2;

beforeAll(async () => {
  const category = await db.category.create({
    data: { name: `${TAG}_category`, slug: `${TAG}-category` },
  });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Return Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Return Test Business",
      businessType: "INDIVIDUAL",
      street: "1 Seller St",
      city: "Seller City",
      state: "Seller State",
      pincode: "111111",
      status: "APPROVED",
    },
  });
  sellerId = seller.id;

  const productA = await db.product.create({
    data: { sellerId, categoryId, name: "Return Test Product A (SKU)", price: 1000, status: "LIVE" },
  });
  productWithSkuId = productA.id;

  const sku = await db.productSKU.create({
    data: { productId: productA.id, sku: `${TAG}-SKU`, price: 1000, stock: SKU_BASELINE_STOCK, options: {} },
  });
  skuId = sku.id;

  const productB = await db.product.create({
    data: {
      sellerId,
      categoryId,
      name: "Return Test Product B (no SKU)",
      price: 500,
      stock: PRODUCT_BASELINE_STOCK,
      status: "LIVE",
    },
  });
  productNoSkuId = productB.id;

  const customer = await db.user.create({
    data: { email: `${TAG}_customer@example.invalid`, name: "Return Test Customer", password: "not-a-real-hash" },
  });
  customerId = customer.id;

  const order = await db.order.create({
    data: {
      sellerId,
      customerId,
      type: "STANDARD",
      status: "RETURNED", 
      totalAmount: 4000,
      items: {
        create: [
          { productId: productWithSkuId, skuId, quantity: SKU_ITEM_QTY, unitPrice: 1000 },
          { productId: productNoSkuId, skuId: null, quantity: PRODUCT_ITEM_QTY, unitPrice: 500 },
        ],
      },
    },
  });
  orderId = order.id;

  const returnRequest = await db.returnRequest.create({
    data: { orderId, customerId, reason: "test", status: "PICKED_UP" },
  });
  returnRequestId = returnRequest.id;

  await db.returnShipment.create({
    data: { returnRequestId, trackingId: TRACKING_ID, status: "IN_TRANSIT" },
  });
});

afterAll(async () => {
  await db.returnShipment.deleteMany({ where: { returnRequestId } });
  await db.returnRequest.deleteMany({ where: { id: returnRequestId } });
  await db.orderItem.deleteMany({ where: { orderId } });
  await db.order.deleteMany({ where: { id: orderId } });
  await db.productSKU.deleteMany({ where: { productId: productWithSkuId } });
  await db.product.deleteMany({ where: { id: { in: [productWithSkuId, productNoSkuId] } } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.user.deleteMany({ where: { id: customerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
});

describe("Return stock restoration", () => {
  test("marking a return DELIVERED restores stock symmetrically (SKU vs Product) exactly once, even if the webhook fires twice", async () => {
    const deliveredEvent = {
      event: "reverse-pickup",
      trackingId: TRACKING_ID,
      status: "delivered",
      raw: {},
    };

    await returnService.handleReversePickupWebhookEvent(deliveredEvent);

    const returnRequestAfterFirst = await db.returnRequest.findUniqueOrThrow({ where: { id: returnRequestId } });
    expect(returnRequestAfterFirst.status).toBe("COMPLETED");

    const skuAfterFirst = await db.productSKU.findUniqueOrThrow({ where: { id: skuId } });
    expect(skuAfterFirst.stock).toBe(SKU_BASELINE_STOCK + SKU_ITEM_QTY);

    const productAfterFirst = await db.product.findUniqueOrThrow({ where: { id: productNoSkuId } });
    expect(productAfterFirst.stock).toBe(PRODUCT_BASELINE_STOCK + PRODUCT_ITEM_QTY);

    await returnService.handleReversePickupWebhookEvent(deliveredEvent);

    const skuAfterSecond = await db.productSKU.findUniqueOrThrow({ where: { id: skuId } });
    expect(skuAfterSecond.stock).toBe(SKU_BASELINE_STOCK + SKU_ITEM_QTY);

    const productAfterSecond = await db.product.findUniqueOrThrow({ where: { id: productNoSkuId } });
    expect(productAfterSecond.stock).toBe(PRODUCT_BASELINE_STOCK + PRODUCT_ITEM_QTY);
  });
});

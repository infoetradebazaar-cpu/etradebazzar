import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import { db } from "../../src/db/index";
import { recommendationService } from "../../src/lib/order-assignment/recommendation.service";
import { storefrontService } from "../../src/modules/storefront/storefront.service";
import { productVariantService } from "../../src/modules/product/product-variant.service";
import { orderService } from "../../src/modules/order/order.service";
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
let shopId: string;
let shopSlug: string;
let customerId: string;
const productIds: string[] = [];

beforeAll(async () => {
  const category = await db.category.create({
    data: { name: `${TAG}_category`, slug: `${TAG}-category` },
  });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Stock Drift Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Stock Drift Test Business",
      businessType: "INDIVIDUAL",
      street: "1 Seller St",
      city: "Seller City",
      state: "Seller State",
      pincode: "111111",
      status: "APPROVED",
    },
  });
  sellerId = seller.id;

  shopSlug = `${TAG}-shop`;
  const shop = await db.shop.create({
    data: {
      sellerId,
      name: "Stock Drift Test Shop",
      slug: shopSlug,
      status: "APPROVED",
      category: "Electronics",
      contactEmail: `${TAG}_shop@example.invalid`,
      contactPhone: "9876543210",
      pickupStreet: "1 Shop St",
      pickupCity: "Shop City",
      pickupState: "Shop State",
      pickupPincode: "111111",
    },
  });
  shopId = shop.id;

  const customer = await db.user.create({
    data: { email: `${TAG}_customer@example.invalid`, name: "Stock Drift Test Customer", password: "not-a-real-hash" },
  });
  customerId = customer.id;
});

afterAll(async () => {
  if (!sellerId) return; // beforeAll didn't get far enough to create anything
  const orders = await db.order.findMany({ where: { sellerId }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await db.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { sellerId } });
  await db.productSKU.deleteMany({ where: { productId: { in: productIds } } });
  await db.variantOptionValue.deleteMany({ where: { option: { productId: { in: productIds } } } });
  await db.variantOption.deleteMany({ where: { productId: { in: productIds } } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  if (shopId) await db.shop.deleteMany({ where: { id: shopId } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  if (customerId) await db.user.deleteMany({ where: { id: customerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
});

describe("Fix 1: recommendation-service shop scoring uses SKU-level stock when a skuId is ordered", () => {
  test("a low-stock SKU is scored against its own stock, not the product's stale aggregate", async () => {
    const product = await db.product.create({
      data: { shopId, sellerId, categoryId, name: "Rec Fix Product", price: 100, stock: 500, status: "LIVE" },
    });
    productIds.push(product.id);
    const lowSku = await db.productSKU.create({
      data: { productId: product.id, sku: `${TAG}-REC-LOW`, price: 100, stock: 2, options: {} },
    });

    const candidates = await recommendationService.getCandidateShops(sellerId, [
      { productId: product.id, skuId: lowSku.id, quantity: 10 },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.avgStockRatio).toBeCloseTo(0.2, 5); // 2/10, from SKU stock
  });

  test("an order with no skuId still falls back to Product.stock (variant-less path unaffected)", async () => {
    const product = await db.product.create({
      data: { shopId, sellerId, categoryId, name: "Rec Fix No-SKU Product", price: 100, stock: 500, status: "LIVE" },
    });
    productIds.push(product.id);

    const candidates = await recommendationService.getCandidateShops(sellerId, [
      { productId: product.id, quantity: 10 },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.avgStockRatio).toBe(1);
  });
});

describe("Fix 2: storefront listing computes summed SKU stock instead of reading the stale Product.stock scalar", () => {
  test("a product with SKUs shows the sum of its SKU stock, not Product.stock", async () => {
    const product = await db.product.create({
      data: { shopId, sellerId, categoryId, name: "Storefront Fix Product", price: 100, stock: 999, status: "LIVE" },
    });
    productIds.push(product.id);
    await db.productSKU.create({ data: { productId: product.id, sku: `${TAG}-SF-A`, price: 100, stock: 3, options: {} } });
    await db.productSKU.create({ data: { productId: product.id, sku: `${TAG}-SF-B`, price: 100, stock: 7, options: { v: "x" } } });

    const listing = await storefrontService.listShopProducts(shopSlug, { limit: 100 });
    const found = listing.data.find((p: any) => p.id === product.id) as any;

    expect(found).toBeTruthy();
    expect(found.stock).toBe(10);
    expect(found.stock).not.toBe(999);
  });

  test("a variant-less product still reports Product.stock directly (no regression)", async () => {
    const product = await db.product.create({
      data: { shopId, sellerId, categoryId, name: "Storefront Fix No-SKU Product", price: 100, stock: 42, status: "LIVE" },
    });
    productIds.push(product.id);

    const listing = await storefrontService.listShopProducts(shopSlug, { limit: 100 });
    const found = listing.data.find((p: any) => p.id === product.id) as any;

    expect(found).toBeTruthy();
    expect(found.stock).toBe(42);
  });
});

describe("Fix 4: createSKU zeroes Product.stock at the variant-less -> variant-having transition", () => {
  async function createProductWithColorVariant(stock: number) {
    const product = await db.product.create({
      data: { shopId, sellerId, categoryId, name: "Drift Fix Product", price: 100, stock, status: "LIVE" },
    });
    productIds.push(product.id);
    const option = await db.variantOption.create({ data: { productId: product.id, name: "Color" } });
    await db.variantOptionValue.create({ data: { optionId: option.id, value: "Black" } });
    return product;
  }

  test("creating the first SKU zeroes a previously nonzero Product.stock in the same transaction", async () => {
    const product = await createProductWithColorVariant(279);

    const sku = await productVariantService.createSKU(sellerId, product.id, {
      sku: `${TAG}-DRIFT-FIRST`,
      price: 100,
      stock: 10,
      options: { Color: "Black" },
    });
    expect(sku.stock).toBe(10);

    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(0);
  });

  test("creating a second SKU for an already-transitioned product leaves Product.stock at 0", async () => {
    const product = await createProductWithColorVariant(150);
    const option = await db.variantOption.create({ data: { productId: product.id, name: "Size" } });
    await db.variantOptionValue.create({ data: { optionId: option.id, value: "M" } });

    await productVariantService.createSKU(sellerId, product.id, {
      sku: `${TAG}-DRIFT-SECOND-A`,
      price: 100,
      stock: 5,
      options: { Color: "Black", Size: "M" },
    });
    const afterFirst = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterFirst.stock).toBe(0);

    await db.variantOptionValue.create({ data: { optionId: option.id, value: "L" } });
    await productVariantService.createSKU(sellerId, product.id, {
      sku: `${TAG}-DRIFT-SECOND-B`,
      price: 100,
      stock: 8,
      options: { Color: "Black", Size: "L" },
    });
    const afterSecond = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterSecond.stock).toBe(0);
  });

  test("a concurrent no-SKU order and first-SKU creation on the same product don't corrupt Product.stock", async () => {
    const product = await createProductWithColorVariant(5);

    const [orderResult, skuResult] = await Promise.allSettled([
      orderService.createOrder(customerId, randomUUID(), {
        sellerId,
        type: "STANDARD" as const,
        items: [{ productId: product.id, quantity: 3 }],
        deliveryAddress: address,
      }),
      productVariantService.createSKU(sellerId, product.id, {
        sku: `${TAG}-DRIFT-RACE`,
        price: 100,
        stock: 20,
        options: { Color: "Black" },
      }),
    ]);

    expect(skuResult.status).toBe("fulfilled");

    if (orderResult.status === "rejected") {
      expect(String((orderResult.reason as any)?.message ?? orderResult.reason)).toContain("Insufficient stock");
    }

    const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(0);

    if (orderResult.status === "fulfilled") {
      await db.orderAddress.deleteMany({ where: { orderId: (orderResult.value as any).id } });
      await db.orderItem.deleteMany({ where: { orderId: (orderResult.value as any).id } });
      await db.order.deleteMany({ where: { id: (orderResult.value as any).id } });
    }
  });
});

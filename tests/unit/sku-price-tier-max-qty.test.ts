import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { resolveTierPrice } from "../../src/utils/tier-pricing";
import { productVariantService } from "../../src/modules/product/product-variant.service";
import { manualNegotiationService } from "../../src/modules/negotiation/manual-negotiation.service";
import { autoNegotiationService } from "../../src/modules/negotiation/auto-negotiation.service";

const TAG = `test_${Date.now()}`;

let categoryId: string;
let sellerId: string;
let customerId: string;
const productIds: string[] = [];
const skuIds: string[] = [];

beforeAll(async () => {
  const category = await db.category.create({
    data: { name: `${TAG}_category`, slug: `${TAG}-category` },
  });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Tier MaxQty Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Tier MaxQty Test Business",
      businessType: "INDIVIDUAL",
      street: "1 Seller St",
      city: "Seller City",
      state: "Seller State",
      pincode: "111111",
      status: "APPROVED",
    },
  });
  sellerId = seller.id;

  const customer = await db.user.create({
    data: { email: `${TAG}_customer@example.invalid`, name: "Tier MaxQty Test Customer", password: "not-a-real-hash" },
  });
  customerId = customer.id;
});

afterAll(async () => {
  if (!sellerId) return;
  await db.negotiationRound.deleteMany({ where: { session: { skuId: { in: skuIds } } } });
  await db.negotiationChatSession.deleteMany({ where: { session: { skuId: { in: skuIds } } } });
  await db.negotiationSession.deleteMany({ where: { skuId: { in: skuIds } } });
  await db.skuPriceTier.deleteMany({ where: { skuId: { in: skuIds } } });
  await db.productSKU.deleteMany({ where: { productId: { in: productIds } } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.user.deleteMany({ where: { id: customerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
});

async function createProductAndSku(basePrice: number) {
  const product = await db.product.create({
    data: { sellerId, categoryId, name: "Tier MaxQty Test Product", price: basePrice, status: "LIVE" },
  });
  productIds.push(product.id);
  const sku = await db.productSKU.create({
    data: { productId: product.id, sku: `${TAG}-${productIds.length}`, price: basePrice, stock: 1000, options: {} },
  });
  skuIds.push(sku.id);
  return { product, sku };
}

describe("resolveTierPrice: explicit maxQty range matching (bounded tier, gap, open-ended top tier)", () => {
  let skuId: string;
  const BASE_PRICE = 1000;

  beforeAll(async () => {
    const { sku } = await createProductAndSku(BASE_PRICE);
    skuId = sku.id;
    await productVariantService.createPriceTier(sellerId, sku.productId, skuId, { minQty: 10, maxQty: 20, price: 900 });
    await productVariantService.createPriceTier(sellerId, sku.productId, skuId, { minQty: 50, price: 800 });
  });

  test("qty below the first tier's minQty -> base", async () => {
    const r = await resolveTierPrice(skuId, 9);
    expect(r.zone).toBe("base");
    expect(r.visiblePrice).toBe(BASE_PRICE);
    expect(r.tierId).toBeNull();
  });

  test("qty at tier A's exact minQty (10) -> tiered, tier A's price", async () => {
    const r = await resolveTierPrice(skuId, 10);
    expect(r.zone).toBe("tiered");
    expect(r.visiblePrice).toBe(900);
  });

  test("qty at tier A's exact maxQty (20) -> tiered, tier A (maxQty is inclusive)", async () => {
    const r = await resolveTierPrice(skuId, 20);
    expect(r.zone).toBe("tiered");
    expect(r.visiblePrice).toBe(900);
  });

  test("qty one past tier A's maxQty (21) -> gap, not tiered and not beyond", async () => {
    const r = await resolveTierPrice(skuId, 21);
    expect(r.zone).toBe("gap");
    expect(r.visiblePrice).toBe(BASE_PRICE);
    expect(r.tierId).toBeNull();
  });

  test("qty one below tier B's minQty (49) -> still gap", async () => {
    const r = await resolveTierPrice(skuId, 49);
    expect(r.zone).toBe("gap");
  });

  test("qty at tier B's exact minQty (50) -> tiered, tier B's price", async () => {
    const r = await resolveTierPrice(skuId, 50);
    expect(r.zone).toBe("tiered");
    expect(r.visiblePrice).toBe(800);
  });

  test("qty at exactly 2x tier B's minQty (100) -> still tiered (2x boundary inclusive)", async () => {
    const r = await resolveTierPrice(skuId, 100);
    expect(r.zone).toBe("tiered");
    expect(r.visiblePrice).toBe(800);
  });

  test("qty one past 2x tier B's minQty (101) -> beyond (open-ended top tier still capped)", async () => {
    const r = await resolveTierPrice(skuId, 101);
    expect(r.zone).toBe("beyond");
    expect(r.visiblePrice).toBe(BASE_PRICE);
  });
});

describe("resolveTierPrice: single explicit-maxQty top tier (no open-ended tier at all)", () => {
  let skuId: string;
  const BASE_PRICE = 500;

  beforeAll(async () => {
    const { sku } = await createProductAndSku(BASE_PRICE);
    skuId = sku.id;
    await productVariantService.createPriceTier(sellerId, sku.productId, skuId, { minQty: 10, maxQty: 30, price: 400 });
  });

  test("qty past the explicitly-capped top tier's maxQty -> gap, not beyond (nothing above it, but it wasn't left open)", async () => {
    const r = await resolveTierPrice(skuId, 31);
    expect(r.zone).toBe("gap");
  });

  test("qty far past it (would have been 'beyond' under the old 2x rule) is still gap, since the seller explicitly capped it", async () => {
    const r = await resolveTierPrice(skuId, 1000);
    expect(r.zone).toBe("gap");
  });
});

describe("Negotiation services: gap zone handled identically to beyond", () => {
  let productId: string;
  let skuId: string;

  beforeAll(async () => {
    const { product, sku } = await createProductAndSku(1000);
    productId = product.id;
    skuId = sku.id;
    await productVariantService.createPriceTier(sellerId, productId, skuId, { minQty: 10, maxQty: 20, price: 900 });
    await productVariantService.createPriceTier(sellerId, productId, skuId, { minQty: 50, price: 800 });
  });

  test("BEFORE/AFTER — auto-negotiation: a gap-zone quantity is rejected the same way a beyond-zone quantity is", async () => {
    const resolution = await resolveTierPrice(skuId, 30); // lands in the gap
    expect(resolution.zone).toBe("gap");

    await expect(
      autoNegotiationService.startSession(customerId, sellerId, productId, skuId, 30),
    ).rejects.toThrow("Quantity is beyond auto-negotiable tiers");
  });

  test("BEFORE/AFTER — manual negotiation: a gap-zone quantity is allowed to start a manual session (not blocked as auto-eligible)", async () => {
    const resolution = await resolveTierPrice(skuId, 30);
    expect(resolution.zone).toBe("gap");

    const session = await manualNegotiationService.startSession(customerId, sellerId, productId, skuId, 30);
    expect(session.mode).toBe("MANUAL");
    expect(Number(session.visibleTierPrice)).toBe(1000);
  });

  test("open-ended-top-tier BEFORE/AFTER — a quantity within the 2x cap remains auto-negotiable; past it, it is rejected like beyond", async () => {
    const { product: p2, sku: sku2 } = await createProductAndSku(1000);
    await productVariantService.createPriceTier(sellerId, p2.id, sku2.id, { minQty: 10, maxQty: 20, price: 900 });
    await productVariantService.createPriceTier(sellerId, p2.id, sku2.id, { minQty: 50, price: 800 });

    const withinCap = await resolveTierPrice(sku2.id, 90);
    expect(withinCap.zone).toBe("tiered");
    const withinCapResult = await autoNegotiationService.startSession(customerId, sellerId, p2.id, sku2.id, 90);
    expect(withinCapResult.session.mode).toBe("AUTO");
    await autoNegotiationService.respond(customerId, withinCapResult.session.id, "REJECT");

    await expect(
      autoNegotiationService.startSession(customerId, sellerId, p2.id, sku2.id, 101),
    ).rejects.toThrow("Quantity is beyond auto-negotiable tiers");
  });
});

describe("Overlap validation: app-layer rejection and DB-trigger rejection (bypassing the app check)", () => {
  let productId: string;
  let skuId: string;

  beforeAll(async () => {
    const { product, sku } = await createProductAndSku(1000);
    productId = product.id;
    skuId = sku.id;
    await productVariantService.createPriceTier(sellerId, productId, skuId, { minQty: 10, maxQty: 20, price: 900 });
  });

  test("app-layer (service call) rejects a new tier overlapping an existing tier's explicit range", async () => {
    await expect(
      productVariantService.createPriceTier(sellerId, productId, skuId, { minQty: 15, maxQty: 25, price: 850 }),
    ).rejects.toThrow(/overlaps/);
  });

  test("app-layer rejects an update that would make a tier overlap another tier's range", async () => {
    const { product: p2, sku: sku2 } = await createProductAndSku(1000);
    const tierA = await productVariantService.createPriceTier(sellerId, p2.id, sku2.id, { minQty: 10, price: 900 });
    await productVariantService.createPriceTier(sellerId, p2.id, sku2.id, { minQty: 50, maxQty: 60, price: 800 });

    await expect(
      productVariantService.updatePriceTier(sellerId, p2.id, sku2.id, tierA.id, { maxQty: 55 }),
    ).rejects.toThrow(/overlaps/);
  });

  test("DB trigger independently rejects an overlap even when the app-layer check is bypassed", async () => {
    let rejected = false;
    try {
      await db.skuPriceTier.create({
        data: { skuId, minQty: 12, maxQty: 25, price: 850 },
      });
    } catch (err: any) {
      rejected = true;
      expect(String(err.message)).toContain("overlaps");
    }
    expect(rejected).toBe(true);

    const tiers = await db.skuPriceTier.findMany({ where: { skuId } });
    expect(tiers).toHaveLength(1);
  });

  test("a non-overlapping (gapped) new tier is accepted by both layers", async () => {
    const created = await productVariantService.createPriceTier(sellerId, productId, skuId, { minQty: 50, price: 800 });
    expect(created.minQty).toBe(50);
  });
});

describe("Backward compatibility: pre-existing (maxQty=null) tiers keep working exactly as before", () => {
  test("a legacy two-tier SKU (no maxQty ever set) resolves identically to the pre-maxQty implicit rule", async () => {
    const { sku } = await createProductAndSku(1000);
    await productVariantService.createPriceTier(sellerId, sku.productId, sku.id, { minQty: 10, price: 900 });
    await productVariantService.createPriceTier(sellerId, sku.productId, sku.id, { minQty: 50, price: 800 });

    expect((await resolveTierPrice(sku.id, 9)).zone).toBe("base");
    expect((await resolveTierPrice(sku.id, 10)).visiblePrice).toBe(900);
    expect((await resolveTierPrice(sku.id, 49)).visiblePrice).toBe(900);
    expect((await resolveTierPrice(sku.id, 50)).visiblePrice).toBe(800);
    expect((await resolveTierPrice(sku.id, 100)).zone).toBe("tiered");
    expect((await resolveTierPrice(sku.id, 101)).zone).toBe("beyond");
  });

  test("updating a legacy tier's price without touching maxQty is not blocked by the new overlap check", async () => {
    const { sku } = await createProductAndSku(1000);
    const tierA = await productVariantService.createPriceTier(sellerId, sku.productId, sku.id, { minQty: 10, price: 900 });
    await productVariantService.createPriceTier(sellerId, sku.productId, sku.id, { minQty: 50, price: 800 });

    const updated = await productVariantService.updatePriceTier(sellerId, sku.productId, sku.id, tierA.id, { price: 850 });
    expect(Number(updated.price)).toBe(850);
  });
});

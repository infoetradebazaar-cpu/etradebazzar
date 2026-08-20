import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import {
  startPricingCircuitBreakerMonitor,
  stopPricingCircuitBreakerMonitor,
} from "../../src/lib/negotiation/pricing-circuit-breaker-monitor";
import { getRolloutPercent, setRolloutPercent, ROLLOUT_PERCENT_KEY } from "../../src/modules/negotiation/pricing-engine-v2/ab-bucketing";

const TEST_INTERVAL_MS = 60;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const TAG = `test_${Date.now()}`;
const ACCEPTANCE_FLOOR_KEY = "negotiation_v2_acceptance_floor";

let categoryId: string;
let sellerId: string;
let productId: string;
let skuId: string;
let customerIds: string[] = [];
const sessionIds: string[] = [];

async function createRejectedSession(customerId: string) {
  const session = await db.negotiationSession.create({
    data: {
      customerId,
      sellerId,
      productId,
      skuId,
      quantity: 2,
      mode: "AUTO",
      visibleTierPrice: 1000,
      hiddenFloorPrice: 500,
      status: "REJECTED",
      formulaVersion: "v2_reservation",
    },
  });
  sessionIds.push(session.id);
}

beforeAll(async () => {
  const category = await db.category.create({ data: { name: `${TAG}_category`, slug: `${TAG}-category` } });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Monitor Wiring Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Monitor Wiring Test Business",
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
    data: { sellerId, categoryId, name: "Monitor Wiring Test Product", price: 1000, status: "LIVE" },
  });
  productId = product.id;

  const sku = await db.productSKU.create({ data: { productId, sku: `${TAG}-SKU`, price: 1000, stock: 100, options: {} } });
  skuId = sku.id;

  const customers = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      db.user.create({ data: { email: `${TAG}_c${i}@example.invalid`, name: `Customer ${i}`, password: "not-a-real-hash" } }),
    ),
  );
  customerIds = customers.map((c) => c.id);

  for (let i = 0; i < 25; i++) await createRejectedSession(customerIds[i]!);

  await db.platformConfig.upsert({
    where: { key: ACCEPTANCE_FLOOR_KEY },
    update: { value: "0.5" },
    create: { key: ACCEPTANCE_FLOOR_KEY, value: "0.5" },
  });
});

afterAll(async () => {
  stopPricingCircuitBreakerMonitor();
  await db.negotiationSession.deleteMany({ where: { id: { in: sessionIds } } });
  await db.user.deleteMany({ where: { id: { in: customerIds } } });
  await db.productSKU.deleteMany({ where: { id: skuId } });
  await db.product.deleteMany({ where: { id: productId } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.platformConfig.deleteMany({ where: { key: { in: [ACCEPTANCE_FLOOR_KEY, ROLLOUT_PERCENT_KEY] } } });
});

describe("Pricing circuit breaker monitor end-to-end wiring", () => {
  test("fires on the configured interval, no-ops at 0% rollout, then trips once rollout is nonzero and the sample breaches", async () => {
    await setRolloutPercent(0, "test-setup");

    const auditCountBefore = await db.auditLog.count({
      where: { action: "NEGOTIATION_V2_CIRCUIT_BREAKER_TRIPPED", entityId: ROLLOUT_PERCENT_KEY },
    });

    startPricingCircuitBreakerMonitor(TEST_INTERVAL_MS);

    // Let a couple of ticks fire while rollout is 0% -> must be a complete no-op.
    await wait(TEST_INTERVAL_MS * 2.5);
    expect(await getRolloutPercent()).toBe(0);
    const auditCountAfterNoOpPhase = await db.auditLog.count({
      where: { action: "NEGOTIATION_V2_CIRCUIT_BREAKER_TRIPPED", entityId: ROLLOUT_PERCENT_KEY },
    });
    expect(auditCountAfterNoOpPhase).toBe(auditCountBefore); // the discriminating assertion

    await setRolloutPercent(50, "test-setup");
    expect(await getRolloutPercent()).toBe(50);

    await wait(TEST_INTERVAL_MS * 2.5);

    expect(await getRolloutPercent()).toBe(0);
    const auditCountAfterTrip = await db.auditLog.count({
      where: { action: "NEGOTIATION_V2_CIRCUIT_BREAKER_TRIPPED", entityId: ROLLOUT_PERCENT_KEY },
    });
    expect(auditCountAfterTrip).toBe(auditCountBefore + 1); // exactly one real trip, from this phase only

    stopPricingCircuitBreakerMonitor();
  });
});

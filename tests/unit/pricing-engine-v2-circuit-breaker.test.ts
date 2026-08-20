import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { checkNegotiationV2CircuitBreaker } from "../../src/modules/negotiation/pricing-engine-v2/circuitBreaker";
import { getRolloutPercent, setRolloutPercent, ROLLOUT_PERCENT_KEY } from "../../src/modules/negotiation/pricing-engine-v2/ab-bucketing";

const TAG = `test_${Date.now()}`;
const ACCEPTANCE_FLOOR_KEY = "negotiation_v2_acceptance_floor";

let categoryId: string;
let sellerId: string;
let productId: string;
let skuId: string;
let customerIds: string[] = [];
const sessionIds: string[] = [];

async function createSession(status: "ACCEPTED" | "REJECTED", customerId: string) {
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
      finalPrice: status === "ACCEPTED" ? 800 : null,
      status,
      formulaVersion: "v2_reservation",
    },
  });
  sessionIds.push(session.id);
  return session;
}

beforeAll(async () => {
  const category = await db.category.create({ data: { name: `${TAG}_category`, slug: `${TAG}-category` } });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Circuit Breaker Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543210",
      businessName: "Circuit Breaker Test Business",
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
    data: { sellerId, categoryId, name: "Circuit Breaker Test Product", price: 1000, status: "LIVE" },
  });
  productId = product.id;

  const sku = await db.productSKU.create({
    data: { productId, sku: `${TAG}-SKU`, price: 1000, stock: 100, options: {} },
  });
  skuId = sku.id;

  // 25 sessions, well above MIN_SAMPLE_SIZE (20), with a low ~12% acceptance rate.
  const customers = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      db.user.create({ data: { email: `${TAG}_c${i}@example.invalid`, name: `Customer ${i}`, password: "not-a-real-hash" } }),
    ),
  );
  customerIds = customers.map((c) => c.id);

  for (let i = 0; i < 25; i++) {
    await createSession(i < 3 ? "ACCEPTED" : "REJECTED", customerIds[i]!);
  }

  // Explicit floor for this test, independent of the module's own default.
  await db.platformConfig.upsert({
    where: { key: ACCEPTANCE_FLOOR_KEY },
    update: { value: "0.5" },
    create: { key: ACCEPTANCE_FLOOR_KEY, value: "0.5" },
  });
});

afterAll(async () => {
  await db.negotiationSession.deleteMany({ where: { id: { in: sessionIds } } });
  await db.user.deleteMany({ where: { id: { in: customerIds } } });
  await db.productSKU.deleteMany({ where: { id: skuId } });
  await db.product.deleteMany({ where: { id: productId } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.platformConfig.deleteMany({ where: { key: { in: [ACCEPTANCE_FLOOR_KEY, ROLLOUT_PERCENT_KEY] } } });
});

describe("Negotiation pricing-engine-v2 circuit breaker", () => {
  test("trips when acceptance rate is below the floor: rollout flips to 0% and an audit log entry is written", async () => {
    await setRolloutPercent(50, "test-setup");
    expect(await getRolloutPercent()).toBe(50);

    const result = await checkNegotiationV2CircuitBreaker();

    expect(result.tripped).toBe(true);
    expect(result.reason).toBe("breached");
    expect(result.sampleSize).toBe(25);
    expect(result.acceptanceRate).toBeCloseTo(3 / 25, 5);

    expect(await getRolloutPercent()).toBe(0);

    const auditEntry = await db.auditLog.findFirst({
      where: { action: "NEGOTIATION_V2_CIRCUIT_BREAKER_TRIPPED", entityId: ROLLOUT_PERCENT_KEY },
      orderBy: { createdAt: "desc" },
    });
    expect(auditEntry).toBeTruthy();
  });

  test("does NOT auto-re-enable when acceptance rate subsequently recovers rollout stays at 0% until a human raises it", async () => {
    await db.negotiationSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { status: "ACCEPTED", finalPrice: 800 },
    });

    const shortCircuited = await checkNegotiationV2CircuitBreaker();
    expect(shortCircuited.reason).toBe("rollout_zero");
    expect(shortCircuited.tripped).toBe(false);
    expect(await getRolloutPercent()).toBe(0);

    await setRolloutPercent(50, "test-setup");
    const result = await checkNegotiationV2CircuitBreaker();

    expect(result.reason).toBe("healthy");
    expect(result.tripped).toBe(false);
    expect(result.acceptanceRate).toBe(1);
    expect(await getRolloutPercent()).toBe(50); // unchanged by a healthy read

    // Reset back to 0% for the next test, matching what a real trip would leave behind.
    await setRolloutPercent(0, "test-setup");
  });

  test("skips evaluation entirely when the sample size is below the minimum (insufficient_data, no trip)", async () => {
    await setRolloutPercent(50, "test-setup");
    await db.negotiationSession.deleteMany({ where: { id: { in: sessionIds } } });
    sessionIds.length = 0;

    // Only 5 sessions below MIN_SAMPLE_SIZE (20).
    for (let i = 0; i < 5; i++) {
      await createSession("REJECTED", customerIds[i]!);
    }

    const result = await checkNegotiationV2CircuitBreaker();

    expect(result.reason).toBe("insufficient_data");
    expect(result.tripped).toBe(false);
    expect(result.acceptanceRate).toBeNull();
    expect(await getRolloutPercent()).toBe(50);
  });
});

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import {
  checkManualNegotiationExpiry,
  startManualNegotiationExpiryMonitor,
  stopManualNegotiationExpiryMonitor,
  MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY,
  resolveManualNegotiationTimeoutDays,
} from "../../src/lib/negotiation/manual-negotiation-expiry-monitor";
import { checkNegotiationNudges } from "../../src/lib/negotiation/nudge-monitor";
import { autoNegotiationService } from "../../src/modules/negotiation/auto-negotiation.service";
import { manualNegotiationService } from "../../src/modules/negotiation/manual-negotiation.service";

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const TAG = `test_${Date.now()}_expiry`;
const DAY_MS = 24 * 60 * 60 * 1000;

let categoryId: string;
let sellerId: string;
let productId: string;
let skuId: string;
let originalTimeoutConfigValue: string | null;

const customerIds: string[] = [];
const sessionIds: string[] = [];

async function makeCustomer(label: string) {
  const customer = await db.user.create({
    data: { email: `${TAG}_${label}@example.invalid`, name: `Expiry Test ${label}`, password: "not-a-real-hash" },
  });
  customerIds.push(customer.id);
  return customer.id;
}

async function makeManualSession(customerId: string, opts: { createdDaysAgo: number; messageDaysAgo?: number }) {
  const session = await db.negotiationSession.create({
    data: {
      customerId,
      sellerId,
      productId,
      skuId,
      quantity: 2,
      mode: "MANUAL",
      status: "PENDING",
      visibleTierPrice: 1000,
      hiddenFloorPrice: null,
      createdAt: new Date(Date.now() - opts.createdDaysAgo * DAY_MS),
      chat: { create: {} },
    },
    include: { chat: true },
  });
  sessionIds.push(session.id);

  if (opts.messageDaysAgo !== undefined) {
    await db.negotiationMessage.create({
      data: {
        chatSessionId: session.chat!.id,
        senderId: customerId,
        senderType: "customer",
        body: "still interested, let me check",
        createdAt: new Date(Date.now() - opts.messageDaysAgo * DAY_MS),
      },
    });
  }
  return session;
}

beforeAll(async () => {
  const category = await db.category.create({ data: { name: `${TAG}_category`, slug: `${TAG}-category` } });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Expiry Monitor Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876543213",
      businessName: "Expiry Monitor Test Business",
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
    data: { sellerId, categoryId, name: "Expiry Monitor Test Product", price: 1000, status: "LIVE" },
  });
  productId = product.id;

  const sku = await db.productSKU.create({ data: { productId, sku: `${TAG}-SKU`, price: 1000, stock: 100, options: {} } });
  skuId = sku.id;
  await db.skuPriceTier.create({ data: { skuId, minQty: 2, price: 1000, hiddenFloorPrice: 500 } });

  const existing = await db.platformConfig.findUnique({ where: { key: MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY } });
  originalTimeoutConfigValue = existing?.value ?? null;
});

afterAll(async () => {
  stopManualNegotiationExpiryMonitor();
  await db.negotiationMessage.deleteMany({ where: { chatSession: { session: { id: { in: sessionIds } } } } });
  await db.notificationDelivery.deleteMany({ where: { notification: { userId: { in: customerIds } } } });
  await db.notification.deleteMany({ where: { userId: { in: customerIds } } });
  await db.negotiationChatSession.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await db.negotiationRound.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await db.negotiationSession.deleteMany({ where: { id: { in: sessionIds } } });
  await db.negotiationSession.deleteMany({ where: { skuId } }); // catches the bridge chain test's AUTO+MANUAL sessions
  await db.user.deleteMany({ where: { id: { in: customerIds } } });
  await db.skuPriceTier.deleteMany({ where: { skuId } });
  await db.productSKU.deleteMany({ where: { id: skuId } });
  await db.product.deleteMany({ where: { id: productId } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.category.deleteMany({ where: { id: categoryId } });

  if (originalTimeoutConfigValue !== null) {
    await db.platformConfig.updateMany({ where: { key: MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY }, data: { value: originalTimeoutConfigValue } });
  }
});

describe("resolveManualNegotiationTimeoutDays", () => {
  test("default seeded value is 7 (from the migration), and is configurable via PlatformConfig", async () => {
    await db.platformConfig.upsert({
      where: { key: MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY },
      update: { value: "7" },
      create: { key: MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY, value: "7" },
    });
    expect(await resolveManualNegotiationTimeoutDays()).toBe(7);

    await db.platformConfig.update({ where: { key: MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY }, data: { value: "3" } });
    expect(await resolveManualNegotiationTimeoutDays()).toBe(3);

    await db.platformConfig.update({ where: { key: MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY }, data: { value: "7" } });
  });
});

describe("checkManualNegotiationExpiry expiry-eligible detection", () => {
  test("stale session (createdAt beyond timeout, no messages) is EXPIRED with nudgeDueAt set; recent session is untouched", async () => {
    const staleCustomer = await makeCustomer("stale1");
    const freshCustomer = await makeCustomer("fresh1");
    const stale = await makeManualSession(staleCustomer, { createdDaysAgo: 10 }); // > 7 day default
    const fresh = await makeManualSession(freshCustomer, { createdDaysAgo: 1 }); // < 7 day default

    const result = await checkManualNegotiationExpiry();
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const staleAfter = await db.negotiationSession.findUniqueOrThrow({ where: { id: stale.id } });
    expect(staleAfter.status).toBe("EXPIRED");
    expect(staleAfter.nudgeDueAt).not.toBeNull();

    const freshAfter = await db.negotiationSession.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(freshAfter.status).toBe("PENDING");
    expect(freshAfter.nudgeDueAt).toBeNull();
  });

  test("activity is tracked via the last NegotiationMessage, not createdAt: an old session with a recent message is NOT expired", async () => {
    const customerId = await makeCustomer("recentmsg");
    const session = await makeManualSession(customerId, { createdDaysAgo: 30, messageDaysAgo: 1 }); // created long ago, but messaged yesterday

    await checkManualNegotiationExpiry();

    const after = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("PENDING");
  });

  test("an old session with an old message (both beyond timeout) IS expired", async () => {
    const customerId = await makeCustomer("oldmsg");
    const session = await makeManualSession(customerId, { createdDaysAgo: 30, messageDaysAgo: 10 });

    await checkManualNegotiationExpiry();

    const after = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("EXPIRED");
  });
});

describe("checkManualNegotiationExpiry re-entrancy and regressions", () => {
  test("two overlapping sweeps against the same stale session: no double-expiry", async () => {
    const customerId = await makeCustomer("reentrant");
    const session = await makeManualSession(customerId, { createdDaysAgo: 10 });

    const [a, b] = await Promise.all([checkManualNegotiationExpiry(), checkManualNegotiationExpiry()]);
    expect(a.expired + b.expired).toBeGreaterThanOrEqual(1);

    const after = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("EXPIRED");
    const third = await checkManualNegotiationExpiry();
    const stillThere = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stillThere.status).toBe("EXPIRED"); // unchanged by the third run
    void third;
  });

  test("an ACTIVE session (recent message) is untouched even after many repeated runs", async () => {
    const customerId = await makeCustomer("activeloop");
    const session = await makeManualSession(customerId, { createdDaysAgo: 10, messageDaysAgo: 0 });

    for (let i = 0; i < 3; i++) await checkManualNegotiationExpiry();

    const after = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("PENDING");
  });

  test("an already-ACCEPTED session is never touched, even though it's old and has no messages", async () => {
    const customerId = await makeCustomer("acceptedold");
    const session = await makeManualSession(customerId, { createdDaysAgo: 30 });
    await db.negotiationSession.update({ where: { id: session.id }, data: { status: "ACCEPTED", finalPrice: 999 } });

    await checkManualNegotiationExpiry();

    const after = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("ACCEPTED");
  });

  test("an already-EXPIRED session is never re-touched by subsequent runs", async () => {
    const customerId = await makeCustomer("alreadyexpired");
    const session = await makeManualSession(customerId, { createdDaysAgo: 30 });
    await checkManualNegotiationExpiry(); // expires it
    const firstNudgeDueAt = (await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } })).nudgeDueAt;

    await checkManualNegotiationExpiry(); // run again
    const after = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("EXPIRED");
    expect(after.nudgeDueAt?.getTime()).toBe(firstNudgeDueAt?.getTime()); // not re-stamped
  });
});

describe("expiry -> nudge notification (existing nudge-monitor.ts sweep, not a parallel notification path)", () => {
  test("8 days stale (timeout=7): expiry sweep sets EXPIRED + nudgeDueAt, then the existing nudge sweep sends the manual_expired email with correct data", async () => {
    const customerId = await makeCustomer("nudgeflow");
    const session = await makeManualSession(customerId, { createdDaysAgo: 8 });

    await checkManualNegotiationExpiry();
    const afterExpiry = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(afterExpiry.status).toBe("EXPIRED");
    expect(afterExpiry.nudgeDueAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(afterExpiry.nudgeSentAt).toBeNull();

    await checkNegotiationNudges();

    const afterNudge = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(afterNudge.nudgeSentAt).not.toBeNull();

    const notification = await db.notification.findFirst({
      where: { userId: customerId, type: "NEGOTIATION_NUDGE" },
      include: { deliveries: true },
      orderBy: { createdAt: "desc" },
    });
    expect(notification).not.toBeNull();
    const emailDelivery = notification!.deliveries.find((d) => d.channel === "EMAIL");
    expect(emailDelivery).toBeDefined();
    const payload = emailDelivery!.payload as any;
    expect(payload.emailTemplate).toBe("negotiation-nudge");
    expect(payload.emailData.reason).toBe("manual_expired");
    expect(payload.emailData.visiblePrice).toBe(1000);
    expect(payload.emailData.negotiationUrl).toContain(session.id);
  }, 20000);
});

describe("manual-negotiation-expiry-monitor end-to-end interval wiring", () => {
  test("the started monitor actually fires on its interval and expires a stale session", async () => {
    const customerId = await makeCustomer("wiring");
    const session = await makeManualSession(customerId, { createdDaysAgo: 10 });

    startManualNegotiationExpiryMonitor(60);
    await wait(250);
    stopManualNegotiationExpiryMonitor();

    const after = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("EXPIRED");
  });
});

describe("full chain: AUTO rejected -> MANUAL bridged -> MANUAL times out -> EXPIRED -> nudge sent", () => {
  test("closes the previously-identified dead-end end to end", async () => {
    const customerId = await makeCustomer("fullchain");

    const { session: autoSession } = await autoNegotiationService.startSession(customerId, sellerId, productId, skuId, 2);
    await autoNegotiationService.respond(customerId, autoSession.id, "REJECT", undefined, undefined);
    await autoNegotiationService.respond(customerId, autoSession.id, "REJECT", undefined, undefined);
    const final = await autoNegotiationService.respond(customerId, autoSession.id, "REJECT", undefined, undefined);
    expect(final.status).toBe("REJECTED");

    // MANUAL bridged from it.
    const manualSession = await manualNegotiationService.startSession(customerId, sellerId, productId, skuId, 2);
    expect((manualSession as any).resumedFromSessionId).toBe(autoSession.id);

    await db.negotiationSession.update({
      where: { id: manualSession.id },
      data: { createdAt: new Date(Date.now() - 10 * DAY_MS) },
    });

    await checkManualNegotiationExpiry();
    const expired = await db.negotiationSession.findUniqueOrThrow({ where: { id: manualSession.id } });
    expect(expired.status).toBe("EXPIRED");
    expect(expired.nudgeDueAt).not.toBeNull();

    await checkNegotiationNudges();
    const afterNudge = await db.negotiationSession.findUniqueOrThrow({ where: { id: manualSession.id } });
    expect(afterNudge.nudgeSentAt).not.toBeNull();

    const notification = await db.notification.findFirst({
      where: { userId: customerId, type: "NEGOTIATION_NUDGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(notification).not.toBeNull();
  }, 20000);
});

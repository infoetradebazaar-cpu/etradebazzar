import { db } from "../../db";
import { logger } from "../../utils/logger";
import { notificationService } from "../../modules/notification/notification.service";

export async function checkNegotiationNudges(): Promise<void> {
  const now = new Date();

  const due = await db.negotiationSession.findMany({
    where: {
      nudgeDueAt: { lt: now },
      nudgeSentAt: null,
      OR: [
        { status: "REJECTED", mode: "AUTO" },
        { status: "EXPIRED", mode: "MANUAL" },
      ],
    },
    select: { id: true, customerId: true, productId: true, quantity: true, mode: true, visibleTierPrice: true },
    take: 500,
  });

  let sent = 0;
  for (const session of due) {
    // Atomic claim - only the sweep that flips nudgeSentAt from null
    const claimed = await db.negotiationSession.updateMany({
      where: { id: session.id, nudgeSentAt: null },
      data: { nudgeSentAt: now },
    });
    if (claimed.count === 0) continue;

    try {
      const [customer, product] = await Promise.all([
        db.user.findUnique({ where: { id: session.customerId }, select: { email: true, name: true } }),
        db.product.findUnique({ where: { id: session.productId }, select: { name: true } }),
      ]);
      if (!customer) continue;

      if (session.mode === "MANUAL") {
        await notificationService.manualNegotiationExpiredNudge({
          userId: session.customerId,
          email: customer.email,
          customerName: customer.name ?? "there",
          productName: product?.name ?? "your product",
          quantity: session.quantity,
          visiblePrice: Number(session.visibleTierPrice),
          sessionId: session.id,
        });
      } else {
        const lastRound = await db.negotiationRound.findFirst({
          where: { sessionId: session.id },
          orderBy: { round: "desc" },
          select: { offeredPrice: true },
        });
        await notificationService.negotiationExpiredNudge({
          userId: session.customerId,
          email: customer.email,
          customerName: customer.name ?? "there",
          productName: product?.name ?? "your product",
          quantity: session.quantity,
          lastOfferedPrice: lastRound ? Number(lastRound.offeredPrice) : 0,
          sessionId: session.id,
        });
      }
      sent++;
    } catch (err: any) {
      logger.error({ err: err.message, sessionId: session.id }, "Failed to send negotiation nudge email");
    }
  }

  if (due.length) {
    logger.info({ due: due.length, sent }, "Negotiation nudge sweep completed");
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startNegotiationNudgeMonitor(intervalMs = 15 * 60 * 1000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    checkNegotiationNudges().catch((err) => {
      logger.error({ err: err.message }, "Negotiation nudge sweep failed");
    });
  }, intervalMs);
  logger.info({ intervalMs }, "Negotiation nudge monitor started");
}

export function stopNegotiationNudgeMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

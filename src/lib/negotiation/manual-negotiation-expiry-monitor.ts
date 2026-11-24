import { db } from "../../db";
import { logger } from "../../utils/logger";
import { scheduleExclusive } from "../jobs/run-exclusive";

export const MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY = "manual_negotiation_timeout_days";
const DEFAULT_TIMEOUT_DAYS = 7;

export async function resolveManualNegotiationTimeoutDays(): Promise<number> {
  const row = await db.platformConfig.findUnique({ where: { key: MANUAL_NEGOTIATION_TIMEOUT_DAYS_KEY } });
  if (!row) return DEFAULT_TIMEOUT_DAYS;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_DAYS;
}

interface ExpiryCandidate {
  id: string;
  sellerId: string;
  createdAt: Date;
  chat: { messages: { createdAt: Date; senderType: string }[] } | null;
}

export const SELLER_NEGOTIATION_FLAG_LIMIT = 3;

async function strikeSeller(sellerId: string, sessionId: string) {
  const seller = await db.seller.update({
    where: { id: sellerId },
    data: { negotiationFlagCount: { increment: 1 } },
    select: { negotiationFlagCount: true, negotiationFlaggedAt: true },
  });
  if (seller.negotiationFlagCount >= SELLER_NEGOTIATION_FLAG_LIMIT && !seller.negotiationFlaggedAt) {
    await db.seller.update({ where: { id: sellerId }, data: { negotiationFlaggedAt: new Date() } });
    await db.auditLog.create({
      data: {
        sellerId,
        actorId: "system",
        actorType: "system",
        action: "SELLER_NEGOTIATION_FLAGGED",
        entityType: "seller",
        entityId: sellerId,
        metadata: { strikes: seller.negotiationFlagCount, lastSessionId: sessionId },
      },
    });
    logger.warn({ sellerId, strikes: seller.negotiationFlagCount }, "Seller flagged for unanswered negotiations");
  }
}

export async function checkManualNegotiationExpiry(): Promise<{ candidates: number; expired: number }> {
  const timeoutDays = await resolveManualNegotiationTimeoutDays();
  const cutoff = new Date(Date.now() - timeoutDays * 24 * 60 * 60 * 1000);
  const now = new Date();

  const candidates: ExpiryCandidate[] = await db.negotiationSession.findMany({
    where: { mode: "MANUAL", status: "PENDING" },
    select: {
      id: true,
      sellerId: true,
      createdAt: true,
      chat: {
        select: {
          messages: { where: { senderType: { not: "system" } }, select: { createdAt: true, senderType: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
    take: 500,
  });

  const stale = candidates.filter((c) => {
    const lastActivityAt = c.chat?.messages[0]?.createdAt ?? c.createdAt;
    return lastActivityAt < cutoff;
  });

  let expired = 0;
  for (const session of stale) {
    const claimed = await db.negotiationSession.updateMany({
      where: { id: session.id, status: "PENDING" },
      data: { status: "EXPIRED", nudgeDueAt: now },
    });
    if (claimed.count > 0) {
      expired++;
      const last = session.chat?.messages[0];
      if (!last || last.senderType === "customer") {
        await strikeSeller(session.sellerId, session.id).catch((err) =>
          logger.error({ err: err.message, sellerId: session.sellerId }, "Seller negotiation strike failed"),
        );
      }
    }
  }

  if (stale.length) {
    logger.info({ candidates: candidates.length, expired }, "Manual negotiation expiry sweep completed");
  }
  return { candidates: candidates.length, expired };
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let checkInFlight = false;

async function runSweep(): Promise<void> {
  if (checkInFlight) {
    logger.warn("Manual negotiation expiry sweep still running, skipping this tick");
    return;
  }
  checkInFlight = true;
  try {
    await checkManualNegotiationExpiry();
  } catch (err: any) {
    logger.error({ err: err.message }, "Manual negotiation expiry sweep failed");
  } finally {
    checkInFlight = false;
  }
}

export function startManualNegotiationExpiryMonitor(intervalMs = 4 * 60 * 60 * 1000): void {
  if (intervalHandle) return;
  intervalHandle = scheduleExclusive("manual-negotiation-expiry", intervalMs, runSweep);
  logger.info({ intervalMs }, "Manual negotiation expiry monitor started");
}

export function stopManualNegotiationExpiryMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
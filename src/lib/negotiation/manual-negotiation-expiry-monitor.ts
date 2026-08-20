import { db } from "../../db";
import { logger } from "../../utils/logger";

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
  createdAt: Date;
  chat: { messages: { createdAt: Date }[] } | null;
}

export async function checkManualNegotiationExpiry(): Promise<{ candidates: number; expired: number }> {
  const timeoutDays = await resolveManualNegotiationTimeoutDays();
  const cutoff = new Date(Date.now() - timeoutDays * 24 * 60 * 60 * 1000);
  const now = new Date();

  const candidates: ExpiryCandidate[] = await db.negotiationSession.findMany({
    where: { mode: "MANUAL", status: "PENDING" },
    select: {
      id: true,
      createdAt: true,
      chat: {
        select: {
          messages: { where: { senderType: { not: "system" } }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
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
    if (claimed.count > 0) expired++;
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
  intervalHandle = setInterval(() => {
    runSweep().catch((err: any) => {
      logger.error({ err: err.message }, "Manual negotiation expiry tick failed");
    });
  }, intervalMs);
  logger.info({ intervalMs }, "Manual negotiation expiry monitor started");
}

export function stopManualNegotiationExpiryMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
import { db } from "../../../db/index";
import { logger } from "../../../utils/logger";
import { EmailFactory } from "../../../lib/notifications/email/email.factory";
import { config } from "../../../../config/config";
import { getRolloutPercent, setRolloutPercent } from "./ab-bucketing";

const ACCEPTANCE_FLOOR_KEY = "negotiation_v2_acceptance_floor";
const DEFAULT_ACCEPTANCE_FLOOR = 0.15;
const MIN_SAMPLE_SIZE = 20; // below this a low ratio is just noise, skip the check
const LOOKBACK_HOURS = 24;

export interface CircuitBreakerResult {
  tripped: boolean;
  reason: "rollout_zero" | "insufficient_data" | "healthy" | "breached";
  acceptanceRate: number | null;
  sampleSize: number;
  floor: number;
}

async function getAcceptanceFloor(): Promise<number> {
  const row = await db.platformConfig.findUnique({ where: { key: ACCEPTANCE_FLOOR_KEY } });
  if (!row) return DEFAULT_ACCEPTANCE_FLOOR;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_ACCEPTANCE_FLOOR;
}

async function sendCircuitBreakerAlert(input: {
  acceptanceRate: number;
  floor: number;
  sampleSize: number;
  previousRolloutPercent: number;
}) {
  await EmailFactory.get().send({
    to: config.securityAlertEmail,
    subject: "🚨 Negotiation pricing-engine-v2 circuit breaker tripped",
    template: "negotiation-v2-circuit-breaker",
    data: {
      acceptanceRate: `${(input.acceptanceRate * 100).toFixed(1)}%`,
      acceptanceFloor: `${(input.floor * 100).toFixed(1)}%`,
      sampleSize: input.sampleSize,
      previousRolloutPercent: `${input.previousRolloutPercent}%`,
      occurredAt: new Date().toISOString(),
    },
  });
}

export async function checkNegotiationV2CircuitBreaker(): Promise<CircuitBreakerResult> {
  const rolloutPercent = await getRolloutPercent();
  if (rolloutPercent <= 0) {
    return { tripped: false, reason: "rollout_zero", acceptanceRate: null, sampleSize: 0, floor: 0 };
  }

  const floor = await getAcceptanceFloor();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const sessions = await db.negotiationSession.findMany({
    where: {
      formulaVersion: "v2_reservation",
      status: { in: ["ACCEPTED", "REJECTED"] },
      updatedAt: { gte: since },
    },
    select: { status: true },
  });

  const sampleSize = sessions.length;
  if (sampleSize < MIN_SAMPLE_SIZE) {
    return { tripped: false, reason: "insufficient_data", acceptanceRate: null, sampleSize, floor };
  }

  const accepted = sessions.filter((s) => s.status === "ACCEPTED").length;
  const acceptanceRate = accepted / sampleSize;

  if (acceptanceRate >= floor) {
    return { tripped: false, reason: "healthy", acceptanceRate, sampleSize, floor };
  }

  const previousRolloutPercent = rolloutPercent;
  logger.error(
    { acceptanceRate, floor, sampleSize, previousRolloutPercent },
    "Negotiation pricing-engine-v2 circuit breaker tripped flipping rollout to 0%",
  );

  await setRolloutPercent(0, "system");

  await db.auditLog
    .create({
      data: {
        actorId: "system",
        actorType: "system",
        action: "NEGOTIATION_V2_CIRCUIT_BREAKER_TRIPPED",
        entityType: "platform_config",
        entityId: "negotiation_v2_rollout_pct",
        metadata: { acceptanceRate, floor, sampleSize, previousRolloutPercent },
      },
    })
    .catch((err: any) => logger.error({ err: err.message }, "Failed to write circuit-breaker trip to AuditLog"));

  sendCircuitBreakerAlert({ acceptanceRate, floor, sampleSize, previousRolloutPercent }).catch((err: any) =>
    logger.error({ err: err.message }, "Failed to send negotiation-v2 circuit breaker alert email"),
  );

  return { tripped: true, reason: "breached", acceptanceRate, sampleSize, floor };
}

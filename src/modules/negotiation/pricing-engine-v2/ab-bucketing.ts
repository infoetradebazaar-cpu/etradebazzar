import { db } from "../../../db/index";
import { deriveSeed, seedFloat } from "./seed";

// plain PlatformConfig key, not the encrypted secrets path
export const ROLLOUT_PERCENT_KEY = "negotiation_v2_rollout_pct";

export type FormulaVersion = "v1_linear" | "v2_reservation";

export async function getRolloutPercent(): Promise<number> {
  const row = await db.platformConfig.findUnique({ where: { key: ROLLOUT_PERCENT_KEY } });
  if (!row) return 0;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

export async function setRolloutPercent(percent: number, actorId: string): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  await db.platformConfig.upsert({
    where: { key: ROLLOUT_PERCENT_KEY },
    update: { value: String(clamped) },
    create: { key: ROLLOUT_PERCENT_KEY, value: String(clamped) },
  });
  await db.auditLog.create({
    data: {
      actorId,
      actorType: actorId === "system" ? "system" : "platform",
      action: "NEGOTIATION_V2_ROLLOUT_UPDATED",
      entityType: "platform_config",
      entityId: ROLLOUT_PERCENT_KEY,
      metadata: { rolloutPercent: clamped },
    },
  });
}

// deterministic bucketing: same (sessionId, skuId, createdAt) always lands the same way.
// own label ("ab-bucket") so this stream doesn't correlate with the offer engine's own jitter/curve rng.
export function assignFormulaVersion(
  sessionId: string,
  skuId: string,
  createdAt: Date,
  rolloutPercent: number,
): FormulaVersion {
  if (rolloutPercent <= 0) return "v1_linear";
  if (rolloutPercent >= 100) return "v2_reservation";
  const seed = deriveSeed(sessionId, skuId, createdAt);
  const bucket = seedFloat(seed, "ab-bucket") * 100;
  return bucket < rolloutPercent ? "v2_reservation" : "v1_linear";
}

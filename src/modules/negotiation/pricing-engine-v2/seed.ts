import { createHash, createHmac, randomBytes } from "crypto";
import { config } from "../../../../config/config";
import { logger } from "../../../utils/logger";

let ephemeralFallbackSecret: string | null = null;
let warnedMissingSecret = false;

function getServerSecret(): string {
  if (config.serverSecret) return config.serverSecret;
  if (!warnedMissingSecret) {
    logger.warn(
      "SERVER_SECRET is not configured pricing-engine-v2 is using a random, process-lifetime-only fallback seed source. This must be set before any non-zero v2 rollout percentage is enabled.",
    );
    warnedMissingSecret = true;
  }
  if (!ephemeralFallbackSecret) ephemeralFallbackSecret = randomBytes(32).toString("hex");
  return ephemeralFallbackSecret;
}

// per-session seed, deterministic k_rand stays fixed across rounds, jitter varies by round
export function deriveSeed(sessionId: string, skuId: string, createdAt: Date): string {
  const secret = getServerSecret();
  const message = `${sessionId}␟sku=${skuId}␟ts=${createdAt.toISOString()}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

// deterministic float in [0, 1) from seed + label (+ round) same inputs, same output every time
export function seedFloat(seed: string, label: string, round?: number): number {
  const suffix = round === undefined ? label : `${label}:${round}`;
  const digest = createHash("sha256").update(`${seed}:${suffix}`).digest();
  const n = digest.readUIntBE(0, 6); // 48 bits well within Number precision
  return n / 2 ** 48;
}

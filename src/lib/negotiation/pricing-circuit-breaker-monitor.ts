import { logger } from "../../utils/logger";
import { checkNegotiationV2CircuitBreaker } from "../../modules/negotiation/pricing-engine-v2/circuitBreaker";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let checkInFlight = false;

async function runCheck(): Promise<void> {
  if (checkInFlight) {
    logger.warn("Negotiation pricing-engine-v2 circuit breaker check still running, skipping this tick");
    return;
  }
  checkInFlight = true;
  try {
    const result = await checkNegotiationV2CircuitBreaker();
    if (result.reason !== "rollout_zero") {
      logger.info(result, "Negotiation pricing-engine-v2 circuit breaker check completed");
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "Negotiation pricing-engine-v2 circuit breaker check failed");
  } finally {
    checkInFlight = false;
  }
}

export function startPricingCircuitBreakerMonitor(intervalMs = 5 * 60 * 1000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runCheck().catch((err: any) => {
      logger.error({ err: err.message }, "Negotiation pricing-engine-v2 circuit breaker tick failed");
    });
  }, intervalMs);
  logger.info({ intervalMs }, "Negotiation pricing-engine-v2 circuit breaker monitor started");
}

export function stopPricingCircuitBreakerMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

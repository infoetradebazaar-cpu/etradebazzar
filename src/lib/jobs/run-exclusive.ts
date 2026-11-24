import { acquireLock, releaseLock } from "../locks/redis-lock";
import { logger } from "../../utils/logger";

export async function runExclusive(name: string, lockTtlSecs: number, fn: () => Promise<unknown>): Promise<void> {
    const key = `job:lock:${name}`;
    let token: string | null = null;
    let redisOk = true;

    try {
        token = await acquireLock(key, lockTtlSecs);
    } catch (err: any) {
        redisOk = false;
        logger.warn({ err: err.message, job: name }, "Job lock unavailable (Redis error), running without it");
    }

    if (redisOk && !token) {
        logger.debug({ job: name }, "Job already running on another instance, skipping tick");
        return;
    }

    try {
        await fn();
    } catch (err: any) {
        logger.error({ err: err.message, job: name }, "Background job failed");
    } finally {
        if (token) {
            await releaseLock(key, token).catch(() => null);
        }
    }
}

export function scheduleExclusive(name: string, intervalMs: number, fn: () => Promise<unknown>) {
    const ttl = Math.max(30, Math.floor(intervalMs / 1000));
    return setInterval(() => {
        void runExclusive(name, ttl, fn);
    }, intervalMs);
}
import { redis } from "../../db/redis";
import { logger } from "../../utils/logger";

const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const key = (source: string, eventId: string) => `webhook:seen:${source}:${eventId}`;

export async function alreadyProcessed(source: string, eventId: string | undefined): Promise<boolean> {
    if (!eventId) return false;
    try {
        return (await redis.exists(key(source, eventId))) === 1;
    } catch (err: any) {
        logger.warn({ err: err.message, source }, "Webhook replay check unavailable");
        return false;
    }
}

export async function markProcessed(source: string, eventId: string | undefined): Promise<void> {
    if (!eventId) return;
    await redis.set(key(source, eventId), "1", "EX", SEEN_TTL_SECONDS).catch(() => null);
}
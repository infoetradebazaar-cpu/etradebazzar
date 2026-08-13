import Redis from "ioredis";
import { config } from "../../../../config/config";
import { sseManager, NotificationPayload } from "./sse.manager";
import { logger } from "../../../utils/logger";

const SSE_CHANNEL_PREFIX = "sse:user:";

let subscriber: Redis | null = null;
export function startSseRedisSubscriber(): void {
    if (subscriber) return;

    subscriber = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 500, 5000),
    });

    subscriber.on("connect", () => logger.info("SSE Redis subscriber connected"));
    subscriber.on("error", (err) => logger.error({ err: err.message }, "SSE Redis subscriber error"));

    subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
        try {
            const userId = channel.replace(SSE_CHANNEL_PREFIX, "");
            const payload = JSON.parse(message) as NotificationPayload;
            sseManager.pushToUser(userId, payload);
        } catch (err: any) {
            logger.error({ err: err.message }, "SSE Redis message parse error");
        }
    });

    subscriber.psubscribe(`${SSE_CHANNEL_PREFIX}*`, (err) => {
        if (err) logger.error({ err: err.message }, "SSE Redis psubscribe failed");
        else logger.info("SSE Redis subscribed to user channels");
    });
}

export async function stopSseRedisSubscriber(): Promise<void> {
    if (!subscriber) return;
    await subscriber.quit();
    subscriber = null;
}
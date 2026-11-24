import { logger } from "../../utils/logger";
import { sseManager } from "../notifications/sse/sse.manager";
import { analyticsRegistry, ViewName } from "./analytics.registry";
import { redis } from "../../db/redis";
import { scheduleExclusive } from "../jobs/run-exclusive";

const EVENT_VIEW_MAP: Record<string, ViewName[]> = {
    ORDER_DELIVERED: [
        "seller_order_stats",
        "seller_daily_revenue",
        "platform_daily_stats",
        "platform_seller_stats",
    ],
    ORDER_CANCELLED: [
        "seller_order_stats",
        "seller_daily_revenue",
        "platform_daily_stats",
        "platform_seller_stats",
    ],
    ORDER_CREATED: [
        "seller_daily_revenue",
        "platform_daily_stats",
    ],
    PRODUCT_ORDERED: [
        "seller_product_stats",
    ],
    PAYOUT_PAID: [
        "platform_seller_stats",
    ],
    RETURN_COMPLETED: [
        "platform_seller_stats",
        "seller_order_stats",
    ],
};

export type AnalyticsEvent = keyof typeof EVENT_VIEW_MAP;

const DIRTY_VIEWS_KEY = "analytics:dirty-views";
const DIRTY_NOTIFY_KEY = "analytics:dirty-notify";
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export async function triggerAnalyticsRefresh(
    event: AnalyticsEvent,
    sellerId?: string,
    adminId?: string
): Promise<void> {
    const views = EVENT_VIEW_MAP[event];
    if (!views?.length) return;

    try {
        const pipeline = redis.pipeline().sadd(DIRTY_VIEWS_KEY, ...views);
        const notify = [sellerId, adminId].filter((id): id is string => !!id);
        if (notify.length) pipeline.sadd(DIRTY_NOTIFY_KEY, ...notify);
        await pipeline.exec();
    } catch (err) {
        if (err instanceof Error) {
            logger.error({ err: err.message, event }, "Failed to mark analytics views stale");
        }
    }
}

async function takeAll(key: string): Promise<string[]> {
    const res = await redis.multi().smembers(key).del(key).exec();
    return (res?.[0]?.[1] as string[] | undefined) ?? [];
}

export async function refreshStaleAnalyticsViews(): Promise<void> {
    const views = (await takeAll(DIRTY_VIEWS_KEY)) as ViewName[];
    if (!views.length) return;
    const notify = await takeAll(DIRTY_NOTIFY_KEY);

    try {
        await analyticsRegistry.refreshMany(views);
    } catch (err) {
        await redis.sadd(DIRTY_VIEWS_KEY, ...views).catch(() => null);
        if (notify.length) await redis.sadd(DIRTY_NOTIFY_KEY, ...notify).catch(() => null);
        throw err;
    }
    logger.info({ views }, "Analytics views refreshed");

    const payload = {
        id: `analytics_${Date.now()}`,
        type: "ANALYTICS_UPDATED",
        title: "Analytics updated",
        message: "Analytics data refreshed",
        data: { views, updatedAt: new Date().toISOString() },
        createdAt: new Date().toISOString(),
    };
    for (const id of notify) {
        sseManager.publish(id, payload).catch(() => null);
    }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startAnalyticsRefresher(
    intervalMs = Number(process.env.ANALYTICS_REFRESH_INTERVAL_MS ?? DEFAULT_REFRESH_INTERVAL_MS),
): void {
    if (intervalHandle) return;
    intervalHandle = scheduleExclusive("analytics-refresh", intervalMs, refreshStaleAnalyticsViews);
    logger.info({ intervalMs }, "Analytics refresher started");
}

export function stopAnalyticsRefresher(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
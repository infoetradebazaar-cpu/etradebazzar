import { db } from "../../db";
import { logger } from "../../utils/logger";
import { reliabilityService } from "../order-assignment/reliability.service";
import { slaConfigService } from "../../modules/platform/sla-config.service";

export async function checkSlaBreaches(): Promise<void> {
    const now = new Date();
    const { sla_breach_penalty_points } = await slaConfigService.getSlaConfig();

    const packingBreaches = await db.order.findMany({
        where: {
            status: "CONFIRMED",
            packingDeadline: { lt: now },
            slaBreachedAt: null,
            assignedShopId: { not: null },
        },
        select: { id: true, assignedShopId: true },
        take: 500,
    });

    for (const order of packingBreaches) {
        if (!order.assignedShopId) continue;
        const claimed = await db.order.updateMany({
            where: { id: order.id, slaBreachedAt: null },
            data: { slaBreachedAt: now },
        });
        if (claimed.count === 0) continue;
        await reliabilityService.applySlaBreachPenalty(
            order.assignedShopId,
            order.id,
            "PACKING_SLA_BREACHED",
            sla_breach_penalty_points as number,
        );
    }

    const dispatchBreaches = await db.order.findMany({
        where: {
            status: "PACKED",
            dispatchDeadline: { lt: now },
            slaBreachedAt: null,
            assignedShopId: { not: null },
        },
        select: {
            id: true,
            assignedShopId: true,
            shipments: { select: { trackingId: true }, take: 1 },
        },
        take: 500,
    });

    for (const order of dispatchBreaches) {
        if (!order.assignedShopId) continue;
        if (order.shipments[0]?.trackingId) continue;

        // Same atomic-claim fix as the packing-breach loop above.
        const claimed = await db.order.updateMany({
            where: { id: order.id, slaBreachedAt: null },
            data: { slaBreachedAt: now },
        });
        if (claimed.count === 0) continue;
        await reliabilityService.applySlaBreachPenalty(
            order.assignedShopId,
            order.id,
            "DISPATCH_SLA_BREACHED",
            sla_breach_penalty_points as number,
        );
    }

    if (packingBreaches.length || dispatchBreaches.length) {
        logger.info(
            { packingBreaches: packingBreaches.length, dispatchBreaches: dispatchBreaches.length },
            "SLA monitor sweep completed",
        );
    }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startSlaMonitor(intervalMs = 15 * 60 * 1000): void {
    if (intervalHandle) return;
    intervalHandle = setInterval(() => {
        checkSlaBreaches().catch((err) => {
            logger.error({ err: err.message }, "SLA monitor sweep failed");
        });
    }, intervalMs);
    logger.info({ intervalMs }, "SLA monitor started");
}

export function stopSlaMonitor(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
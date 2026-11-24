import { db } from "../../db";
import { logger } from "../../utils/logger";
import { reliabilityService } from "../order-assignment/reliability.service";
import { slaConfigService } from "../../modules/platform/sla-config.service";
import { orderService } from "../../modules/order/order.service";
import { SELLER_APPROVAL_WINDOW_HOURS } from "../../modules/invoicing/invoicing.service";
import { addWorkingHours } from "./working-hours";
import { scheduleExclusive } from "../jobs/run-exclusive";

async function cancelUnapprovedPaidOrders(now: Date): Promise<number> {
    const calendarCutoff = new Date(now.getTime() - SELLER_APPROVAL_WINDOW_HOURS * 60 * 60 * 1000);
    const candidates = await db.order.findMany({
        where: {
            sellerApprovedAt: null,
            paymentStatus: { in: ["PAID", "PARTIALLY_PAID"] },
            status: { in: ["PENDING", "PENDING_ASSIGNMENT", "CONFIRMED"] },
            payments: { some: { status: "PAID", updatedAt: { lt: calendarCutoff } } },
        },
        select: {
            id: true,
            payments: { where: { status: "PAID" }, select: { updatedAt: true }, orderBy: { updatedAt: "asc" }, take: 1 },
        },
        take: 200,
    });

    let cancelled = 0;
    for (const order of candidates) {
        const paidAt = order.payments[0]?.updatedAt;
        if (!paidAt || addWorkingHours(paidAt, SELLER_APPROVAL_WINDOW_HOURS) > now) continue;
        try {
            await orderService.cancelOrder(
                order.id,
                "system",
                "system",
                undefined,
                undefined,
                `Seller did not approve within ${SELLER_APPROVAL_WINDOW_HOURS} working hours`,
            );
            cancelled++;
        } catch (err: any) {
            logger.error({ err: err.message, orderId: order.id }, "Auto-cancel of unapproved paid order failed");
        }
    }
    return cancelled;
}

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

    const approvalTimeouts = await cancelUnapprovedPaidOrders(now);

    if (packingBreaches.length || dispatchBreaches.length || approvalTimeouts) {
        logger.info(
            { packingBreaches: packingBreaches.length, dispatchBreaches: dispatchBreaches.length, approvalTimeouts },
            "SLA monitor sweep completed",
        );
    }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startSlaMonitor(intervalMs = 15 * 60 * 1000): void {
    if (intervalHandle) return;
    intervalHandle = scheduleExclusive("sla-monitor", intervalMs, checkSlaBreaches);
    logger.info({ intervalMs }, "SLA monitor started");
}

export function stopSlaMonitor(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
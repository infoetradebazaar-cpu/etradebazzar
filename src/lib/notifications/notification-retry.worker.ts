import { db } from "../../db";
import { logger } from "../../utils/logger";
import { EmailFactory } from "./email/email.factory";
import { SmsFactory } from "./sms/sms.factory";
import { interpolateTemplate } from "./template-interpolation";
import { computeNextRetryAt, MAX_DELIVERY_ATTEMPTS } from "./retry-backoff";
import { adminNotificationService } from "../../modules/notification/admin-notification.service";

async function retryOne(delivery: {
    id: string;
    channel: "EMAIL" | "SMS" | "SSE";
    attempts: number;
    payload: any;
}): Promise<void> {
    const claimed = await db.notificationDelivery.updateMany({
        where: { id: delivery.id, status: "FAILED" },
        data: { status: "RETRYING" },
    });
    if (claimed.count === 0) return;

    try {
        if (delivery.channel === "EMAIL") {
            const p = delivery.payload as { email: string; emailTemplate: string; emailData: Record<string, any>; title: string; type: string };
            const override = await adminNotificationService.getActiveOverride(p.type as any).catch(() => null);
            await (override
                ? EmailFactory.get().send({
                    to: p.email,
                    subject: interpolateTemplate(override.subject, p.emailData ?? {}),
                    template: p.emailTemplate as any,
                    data: p.emailData ?? {},
                    html: interpolateTemplate(override.bodyHtml, p.emailData ?? {}),
                })
                : EmailFactory.get().send({
                    to: p.email,
                    subject: p.title,
                    template: p.emailTemplate as any,
                    data: p.emailData ?? {},
                }));
        } else if (delivery.channel === "SMS") {
            const p = delivery.payload as { phone: string; smsTemplateId: string; smsVariables?: Record<string, string> };
            await SmsFactory.get().send({
                to: p.phone,
                templateId: p.smsTemplateId,
                variables: p.smsVariables,
                type: "TRANSACTIONAL",
            });
        }

        await db.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: "SENT", lastAttemptAt: new Date(), attempts: { increment: 1 } },
        });
    } catch (err: any) {
        const newAttempts = delivery.attempts + 1;
        const exhausted = newAttempts >= MAX_DELIVERY_ATTEMPTS;
        await db.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
                status: exhausted ? "EXHAUSTED" : "FAILED",
                attempts: newAttempts,
                lastAttemptAt: new Date(),
                lastError: String(err.message ?? err).slice(0, 500),
                nextRetryAt: exhausted ? null : computeNextRetryAt(newAttempts),
            },
        });
    }
}

export async function checkFailedNotificationDeliveries(): Promise<void> {
    const due = await db.notificationDelivery.findMany({
        where: {
            status: "FAILED",
            channel: { in: ["EMAIL", "SMS"] },
            nextRetryAt: { lte: new Date() },
            attempts: { lt: MAX_DELIVERY_ATTEMPTS },
        },
        select: { id: true, channel: true, attempts: true, payload: true },
        take: 200,
    });

    let retried = 0;
    for (const delivery of due) {
        try {
            await retryOne(delivery as any);
            retried++;
        } catch (err: any) {
            logger.error({ err: err.message, deliveryId: delivery.id }, "Notification delivery retry threw unexpectedly");
        }
    }

    if (due.length) {
        logger.info({ due: due.length, retried }, "Notification delivery retry sweep completed");
    }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startNotificationRetryWorker(intervalMs = 5 * 60 * 1000): void {
    if (intervalHandle) return;
    intervalHandle = setInterval(() => {
        checkFailedNotificationDeliveries().catch((err) => {
            logger.error({ err: err.message }, "Notification delivery retry sweep failed");
        });
    }, intervalMs);
    logger.info({ intervalMs }, "Notification delivery retry worker started");
}

export function stopNotificationRetryWorker(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}

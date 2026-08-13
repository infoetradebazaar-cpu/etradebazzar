import { db } from "../../db/index";
import { NotificationType } from "../../../prisma/generated/client";
import { NOTIFICATION_EVENT_CATALOG } from "./notification.catalog";

export const adminNotificationService = {
    async getActiveOverride(type: NotificationType) {
        return db.notificationTemplate.findUnique({ where: { type, isActive: true } });
    },

    async getTemplate(type: NotificationType) {
        const definition = NOTIFICATION_EVENT_CATALOG[type];
        if (!definition) throw new Error("Unknown notification type");
        if (!definition.emailTemplate) {
            throw new Error(`${type} has no email template - it is not an email-capable event`);
        }

        const override = await db.notificationTemplate.findUnique({ where: { type } });
        return {
            type,
            label: definition.label,
            description: definition.description,
            variables: definition.variables,
            isOverridden: !!override?.isActive,
            subject: override?.subject ?? null,
            bodyHtml: override?.bodyHtml ?? null,
            updatedAt: override?.updatedAt ?? null,
            updatedBy: override?.updatedBy ?? null,
        };
    },

    async upsertTemplate(type: NotificationType, data: { subject: string; bodyHtml: string }, actorId: string) {
        const definition = NOTIFICATION_EVENT_CATALOG[type];
        if (!definition) throw new Error("Unknown notification type");
        if (!definition.emailTemplate) {
            throw new Error(`${type} has no email template - it is not an email-capable event`);
        }
        if (!data.subject.trim()) throw new Error("Subject cannot be empty");
        if (!data.bodyHtml.trim()) throw new Error("Body cannot be empty");

        return db.notificationTemplate.upsert({
            where: { type },
            update: { subject: data.subject, bodyHtml: data.bodyHtml, isActive: true, updatedBy: actorId },
            create: { type, subject: data.subject, bodyHtml: data.bodyHtml, isActive: true, updatedBy: actorId },
        });
    },

    async revertTemplate(type: NotificationType) {
        const existing = await db.notificationTemplate.findUnique({ where: { type } });
        if (!existing) return null;
        await db.notificationTemplate.delete({ where: { type } });
        return { reverted: true };
    },

    async listDeliveries(filters: { status?: string; channel?: string; page?: number; limit?: number }) {
        const page = filters.page ?? 1;
        const limit = Math.min(filters.limit ?? 20, 100);
        const where: any = {};
        if (filters.status) where.status = filters.status;
        if (filters.channel) where.channel = filters.channel;

        const [data, total] = await Promise.all([
            db.notificationDelivery.findMany({
                where,
                select: {
                    id: true, notificationId: true, channel: true, status: true,
                    attempts: true, maxAttempts: true, lastError: true,
                    lastAttemptAt: true, nextRetryAt: true, createdAt: true,
                    notification: { select: { type: true, title: true, userId: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.notificationDelivery.count({ where }),
        ]);
        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
    },
};

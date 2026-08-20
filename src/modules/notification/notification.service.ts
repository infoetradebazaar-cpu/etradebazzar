import { db } from "../../db/index";
import { EmailFactory } from "../../lib/notifications/email/email.factory";
import { SmsFactory } from "../../lib/notifications/sms/sms.factory";
import { sseManager } from "../../lib/notifications/sse/sse.manager";
import { logger } from "../../utils/logger";
import { config } from "../../../config/config";
import {
    ALL_CATEGORIES,
    NON_DISABLEABLE_CATEGORIES,
} from "./notification.constants";
import { TYPE_TO_CATEGORY } from "./notification.catalog";
import { adminNotificationService } from "./admin-notification.service";
import { interpolateTemplate } from "../../lib/notifications/template-interpolation";
import { computeNextRetryAt } from "../../lib/notifications/retry-backoff";
import { NotificationCategory, NotificationDeliveryChannel } from "../../../prisma/generated/client";

export type NotifyChannel = "email" | "sms" | "sse";

interface NotifyInput {
    userId: string;
    email?: string;
    phone?: string;
    type: string;
    title: string;
    message: string;
    channels: NotifyChannel[];
    emailTemplate?: string;
    emailData?: Record<string, any>;
    smsTemplateId?: string;
    smsVariables?: Record<string, string>;
    data?: Record<string, any>;
}

export const notificationService = {
    async isCategoryEnabled(userId: string, category: NotificationCategory): Promise<boolean> {
        if (NON_DISABLEABLE_CATEGORIES.includes(category)) return true;
        const pref = await db.notificationPreference.findUnique({
            where: { userId_category: { userId, category } },
        });
        return pref?.enabled ?? true;
    },

    async notify(input: NotifyInput) {
        const category = TYPE_TO_CATEGORY[input.type as keyof typeof TYPE_TO_CATEGORY];
        if (category) {
            const enabled = await this.isCategoryEnabled(input.userId, category);
            if (!enabled) {
                logger.info({ userId: input.userId, type: input.type, category }, "Notification suppressed by user preference");
                return null;
            }
        }

        if (input.channels.includes("email") && !input.emailTemplate) {
            logger.warn(
                { type: input.type, userId: input.userId },
                "notify() called with 'email' in channels but no emailTemplate - email will not be sent",
            );
        }

        const notification = await db.notification.create({
            data: {
                userId: input.userId,
                type: input.type as any,
                title: input.title,
                message: input.message,
                data: input.data,
            },
        });

        const trackDelivery = async (
            channel: NotificationDeliveryChannel,
            payload: Record<string, any>,
            send: () => Promise<any>,
        ) => {
            const delivery = await db.notificationDelivery.create({
                data: { notificationId: notification.id, channel, status: "PENDING", payload },
            });
            try {
                const result = await send();
                await db.notificationDelivery.update({
                    where: { id: delivery.id },
                    data: { status: "SENT", attempts: 1, lastAttemptAt: new Date() },
                });
                return result;
            } catch (err: any) {
                await db.notificationDelivery.update({
                    where: { id: delivery.id },
                    data: {
                        status: "FAILED",
                        attempts: 1,
                        lastAttemptAt: new Date(),
                        lastError: String(err.message ?? err).slice(0, 500),
                        nextRetryAt: channel === "SSE" ? null : computeNextRetryAt(1),
                    },
                });
                throw err;
            }
        };

        const sendEmail = async () => {
            if (!(input.channels.includes("email") && input.email && input.emailTemplate)) return;

            const override = await adminNotificationService.getActiveOverride(input.type as any).catch(() => null);

            const emailPayload = {
                email: input.email,
                emailTemplate: input.emailTemplate,
                emailData: input.emailData ?? {},
                title: input.title,
                type: input.type,
            };

            return trackDelivery("EMAIL", emailPayload, () =>
                override
                    ? EmailFactory.get().send({
                        to: input.email!,
                        subject: interpolateTemplate(override.subject, input.emailData ?? {}),
                        template: input.emailTemplate as any,
                        data: input.emailData ?? {},
                        html: interpolateTemplate(override.bodyHtml, input.emailData ?? {}),
                    })
                    : EmailFactory.get().send({
                        to: input.email!,
                        subject: input.title,
                        template: input.emailTemplate as any,
                        data: input.emailData ?? {},
                    }),
            );
        };

        const sendSms = async () => {
            if (!(input.channels.includes("sms") && input.phone && input.smsTemplateId)) return;
            const smsPayload = {
                phone: input.phone,
                smsTemplateId: input.smsTemplateId,
                smsVariables: input.smsVariables ?? {},
            };
            return trackDelivery("SMS", smsPayload, () =>
                SmsFactory.get().send({
                    to: input.phone!,
                    templateId: input.smsTemplateId!,
                    variables: input.smsVariables,
                    type: "TRANSACTIONAL",
                }),
            );
        };

        const sendSse = async () => {
            if (!input.channels.includes("sse")) return;
            return trackDelivery("SSE", {}, () =>
                sseManager.publish(input.userId, {
                    id: notification.id,
                    type: input.type,
                    title: input.title,
                    message: input.message,
                    data: input.data,
                    createdAt: notification.createdAt.toISOString(),
                }),
            );
        };

        const results = await Promise.allSettled([sendEmail(), sendSms(), sendSse()]);

        results.forEach((result, i) => {
            if (result.status === "rejected") {
                const channel = ["email", "sms", "sse"][i];
                logger.error({ err: result.reason?.message, channel }, "Notification delivery failed");
            }
        });

        return notification;
    },

    async sellerApproved(params: { userId: string; email: string; sellerName: string; businessName: string }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "SELLER_APPROVED",
            title: "Seller account approved",
            message: `Your seller account for ${params.businessName} has been approved.`,
            channels: ["email", "sse"],
            emailTemplate: "seller-approved",
            emailData: {
                sellerName: params.sellerName,
                businessName: params.businessName,
                loginUrl: `${config.appUrl}/dashboard`,
            },
        });
    },

    async sellerRejected(params: { userId: string; email: string; sellerName: string; businessName: string; reason: string }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "SELLER_REJECTED",
            title: "Seller application update",
            message: `Your application for ${params.businessName} was not approved.`,
            channels: ["email", "sse"],
            emailTemplate: "seller-rejected",
            emailData: {
                sellerName: params.sellerName,
                businessName: params.businessName,
                reason: params.reason,
            },
        });
    },

    async productApproved(params: { userId: string; email: string; sellerName: string; productName: string; note?: string }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "PRODUCT_APPROVED",
            title: "Product approved",
            message: `Your product "${params.productName}" has been approved.`,
            channels: ["email", "sse"],
            emailTemplate: "product-approved",
            emailData: {
                sellerName: params.sellerName,
                productName: params.productName,
                dashboardUrl: `${config.appUrl}/products`,
                note: params.note,
            },
        });
    },

    async productRejected(params: { userId: string; email: string; sellerName: string; productName: string; reason: string }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "PRODUCT_REJECTED",
            title: "Product needs attention",
            message: `Your product "${params.productName}" was rejected.`,
            channels: ["email", "sse"],
            emailTemplate: "product-rejected",
            emailData: {
                sellerName: params.sellerName,
                productName: params.productName,
                reason: params.reason,
            },
        });
    },

    async orderPlaced(params: {
        userId: string; email: string; phone?: string;
        customerName: string; orderId: string; orderType: string;
        items: { name: string; quantity: number; unitPrice: number }[];
        totalAmount: number;
    }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            phone: params.phone,
            type: "ORDER_PLACED",
            title: "Order placed successfully",
            message: `Your order #${params.orderId} has been placed.`,
            channels: ["email", "sms", "sse"],
            emailTemplate: "order-placed",
            emailData: {
                customerName: params.customerName,
                orderId: params.orderId,
                orderType: params.orderType,
                items: params.items,
                totalAmount: params.totalAmount,
                orderUrl: `${config.appUrl}/orders/${params.orderId}`,
            },
            smsTemplateId: config.msg91OrderPlacedTemplateId,
            smsVariables: { VAR1: params.orderId, VAR2: String(params.totalAmount) },
        });
    },

    async negotiationExpiredNudge(params: {
        userId: string;
        email: string;
        customerName: string;
        productName: string;
        quantity: number;
        lastOfferedPrice: number;
        sessionId: string;
    }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "NEGOTIATION_NUDGE",
            title: "Still interested? Talk directly with the seller",
            message: `Our best automated offer for ${params.productName} didn't work out you can negotiate directly with the seller instead.`,
            channels: ["email", "sse"],
            emailTemplate: "negotiation-nudge",
            emailData: {
                reason: "auto_rejected",
                customerName: params.customerName,
                productName: params.productName,
                quantity: params.quantity,
                lastOfferedPrice: params.lastOfferedPrice,
                negotiationUrl: `${config.appUrl}/negotiations/${params.sessionId}`,
            },
        });
    },

    async manualNegotiationExpiredNudge(params: {
        userId: string;
        email: string;
        customerName: string;
        productName: string;
        quantity: number;
        visiblePrice: number;
        sessionId: string;
    }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "NEGOTIATION_NUDGE",
            title: "Your negotiation is still open",
            message: `Your negotiation for ${params.productName} didn't conclude - it's still available at the listed price.`,
            channels: ["email", "sse"],
            emailTemplate: "negotiation-nudge",
            emailData: {
                reason: "manual_expired",
                customerName: params.customerName,
                productName: params.productName,
                quantity: params.quantity,
                visiblePrice: params.visiblePrice,
                negotiationUrl: `${config.appUrl}/negotiations/${params.sessionId}`,
            },
        });
    },

    async manualNegotiationStarted(params: {
        userId: string;
        email: string;
        sellerName: string;
        productName: string;
        quantity: number;
        sessionId: string;
    }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "MANUAL_NEGOTIATION_STARTED",
            title: "New negotiation request",
            message: `A buyer wants to negotiate a bulk price on ${params.productName} (qty ${params.quantity}).`,
            channels: ["email", "sse"],
            emailTemplate: "manual-negotiation-started",
            emailData: {
                sellerName: params.sellerName,
                productName: params.productName,
                quantity: params.quantity,
                negotiationUrl: `${config.appUrl}/negotiations/manual/${params.sessionId}`,
            },
        });
    },

    async orderConfirmed(params: { userId: string; email: string; customerName: string; orderId: string; finalAmount: number }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "ORDER_CONFIRMED",
            title: "Order confirmed",
            message: `Your order #${params.orderId} has been confirmed.`,
            channels: ["email", "sse"],
            emailTemplate: "order-confirmed",
            emailData: {
                customerName: params.customerName,
                orderId: params.orderId,
                finalAmount: params.finalAmount,
                orderUrl: `${config.appUrl}/orders/${params.orderId}`,
            },
        });
    },

    async orderCancelled(params: { userId: string; email: string; customerName: string; orderId: string }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            type: "ORDER_CANCELLED",
            title: "Order cancelled",
            message: `Your order #${params.orderId} has been cancelled.`,
            channels: ["email", "sse"],
            emailTemplate: "order-cancelled",
            emailData: {
                customerName: params.customerName,
                orderId: params.orderId,
                orderUrl: `${config.appUrl}/orders/${params.orderId}`,
            },
        });
    },

    async shipmentUpdated(params: {
        userId: string; email: string; phone?: string;
        customerName: string; orderId: string; status: string;
        trackingId?: string; trackingUrl?: string; estimatedDelivery?: string;
    }) {
        return this.notify({
            userId: params.userId,
            email: params.email,
            phone: params.phone,
            type: "SHIPMENT_UPDATED",
            title: "Shipment update",
            message: `Your shipment for order #${params.orderId} status: ${params.status}`,
            channels: ["email", "sms", "sse"],
            emailTemplate: "shipment-updated",
            emailData: {
                customerName: params.customerName,
                orderId: params.orderId,
                status: params.status,
                trackingId: params.trackingId,
                trackingUrl: params.trackingUrl,
                estimatedDelivery: params.estimatedDelivery,
            },
            smsTemplateId: config.msg91ShipmentTemplateId,
            smsVariables: { VAR1: params.orderId, VAR2: params.status },
        });
    },

    async getNotifications(userId: string, page = 1, limit = 20) {
        const cappedLimit = Math.min(limit, 100);
        const [notifications, unreadCount] = await Promise.all([
            db.notification.findMany({
                where: { userId },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * cappedLimit,
                take: cappedLimit,
            }),
            db.notification.count({ where: { userId, isRead: false } }),
        ]);
        return { notifications, unreadCount, page, limit: cappedLimit };
    },

    async markAsRead(userId: string, notificationIds: string[]) {
        return db.notification.updateMany({
            where: { userId, id: { in: notificationIds } },
            data: { isRead: true },
        });
    },

    async markAllAsRead(userId: string) {
        return db.notification.updateMany({
            where: { userId, isRead: false },
            data: { isRead: true },
        });
    },

    async getPreferences(userId: string) {
        const rows = await db.notificationPreference.findMany({ where: { userId } });
        const byCategory = new Map(rows.map((r) => [r.category, r.enabled]));
        return ALL_CATEGORIES.map((category) => ({
            category,
            enabled: NON_DISABLEABLE_CATEGORIES.includes(category)
                ? true
                : byCategory.get(category) ?? true,
            locked: NON_DISABLEABLE_CATEGORIES.includes(category),
        }));
    },

    async updatePreferences(
        userId: string,
        updates: { category: NotificationCategory; enabled: boolean }[],
    ) {
        const writable = updates.filter(
            (u) => !NON_DISABLEABLE_CATEGORIES.includes(u.category),
        );
        await db.$transaction(
            writable.map((u) =>
                db.notificationPreference.upsert({
                    where: { userId_category: { userId, category: u.category } },
                    update: { enabled: u.enabled },
                    create: { userId, category: u.category, enabled: u.enabled },
                }),
            ),
        );
        return this.getPreferences(userId);
    },
};
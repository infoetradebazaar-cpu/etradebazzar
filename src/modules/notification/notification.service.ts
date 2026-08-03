import { db } from "../../db/index";
import { EmailFactory } from "../../lib/notifications/email/email.factory";
import { SmsFactory } from "../../lib/notifications/sms/sms.factory";
import { sseManager } from "../../lib/notifications/sse/sse.manager";
import { logger } from "../../utils/logger";
import { config } from "../../../config/config";

type NotifyChannel = "email" | "sms" | "sse";

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
    async notify(input: NotifyInput) {
        const notification = await db.notification.create({
            data: {
                userId: input.userId,
                type: input.type as any,
                title: input.title,
                message: input.message,
                data: input.data,
            },
        });

        const results = await Promise.allSettled([
            input.channels.includes("email") && input.email && input.emailTemplate
                ? EmailFactory.get().send({
                    to: input.email,
                    subject: input.title,
                    template: input.emailTemplate as any,
                    data: input.emailData ?? {},
                })
                : Promise.resolve(),

            input.channels.includes("sms") && input.phone && input.smsTemplateId
                ? SmsFactory.get().send({
                    to: input.phone,
                    templateId: input.smsTemplateId,
                    variables: input.smsVariables,
                    type: "TRANSACTIONAL",
                })
                : Promise.resolve(),

            input.channels.includes("sse")
                ? sseManager.publish(input.userId, {
                    id: notification.id,
                    type: input.type,
                    title: input.title,
                    message: input.message,
                    data: input.data,
                    createdAt: notification.createdAt.toISOString(),
                })
                : Promise.resolve(),
        ]);

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
};
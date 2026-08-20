import { db } from "../../db/index";
import { redis } from "../../db/redis";
import { PaymentFactory } from "../../lib/payments/payment.factory";
import { notificationService } from "../notification/notification.service";
import { logger } from "../../utils/logger";
import { getPlatformConfigBool } from "../../lib/platform-config/platform-config";
import { encrypt } from "../../utils/encryption";

const PAYMENT_LOCK_TTL = 15;
const REFUND_CLAIM_TTL = 300;
const ONLINE_PAYMENTS_CONFIG_KEY = "online_payments_enabled";

async function assertOnlinePaymentsEnabled(): Promise<void> {
    const enabled = await getPlatformConfigBool(ONLINE_PAYMENTS_CONFIG_KEY, true);
    if (!enabled) {
        throw new Error("Online payments are currently disabled - use manual/cash payment recording instead");
    }
}

function getAdvancePercent(orderType: string): number {
    return orderType === "HIGH_TICKET" ? 50 : 20;
}

async function acquirePaymentLock(key: string): Promise<boolean> {
    const result = await redis.set(`payment:lock:${key}`, "1", "EX", PAYMENT_LOCK_TTL, "NX");
    return result === "OK";
}

async function releasePaymentLock(key: string): Promise<void> {
    await redis.del(`payment:lock:${key}`);
}

async function claimRefund(paymentId: string): Promise<boolean> {
    const result = await redis.set(`payment:refund-claim:${paymentId}`, "1", "EX", REFUND_CLAIM_TTL, "NX");
    return result === "OK";
}

async function notifyPaymentReceived(orderId: string, amount: number) {
    const order = await db.order.findUnique({
        where: { id: orderId },
        select: { customerId: true },
    });
    if (!order) return;

    const customer = await db.user.findUnique({
        where: { id: order.customerId },
        select: { email: true, name: true },
    });
    if (!customer) return;

    notificationService.notify({
        userId: order.customerId,
        email: customer.email,
        type: "PAYMENT_RECEIVED",
        title: "Payment received",
        message: `Payment of ₹${amount.toFixed(2)} received for order #${orderId}`,
        channels: ["sse"],
        data: { orderId, amount },
    }).catch(() => null);
}
export const paymentService = {
    async createAdvancePayment(orderId: string) {
        await assertOnlinePaymentsEnabled();

        const lockKey = `${orderId}:advance`;
        const locked = await acquirePaymentLock(lockKey);
        if (!locked) throw new Error("Payment initiation already in progress, please wait");

        try {
            const order = await db.order.findUnique({
                where: { id: orderId },
                include: { payments: true },
            });
            if (!order) throw new Error("Order not found");
            if (!["CONFIRMED"].includes(order.status)) {
                throw new Error("Order not in payable state");
            }

            const existingAdvance = order.payments.find((p) => p.type === "ADVANCE" && p.status !== "FAILED");
            if (existingAdvance) throw new Error("Advance payment already initiated");

            const baseAmount = Number(order.finalAmount ?? order.totalAmount);
            const percent = getAdvancePercent(order.type);
            const advanceAmount = parseFloat(((baseAmount * percent) / 100).toFixed(2));

            const gateway = PaymentFactory.get();
            const gatewayOrder = await gateway.createOrder({
                amount: advanceAmount,
                currency: "INR",
                receipt: `adv_${orderId}`,
                notes: { orderId, type: "ADVANCE", percent: String(percent) },
            });

            const payment = await db.payment.create({
                data: {
                    orderId,
                    razorpayOrderId: gatewayOrder.gatewayOrderId,
                    amount: advanceAmount,
                    type: "ADVANCE",
                    status: "UNPAID",
                    metadata: { percent, baseAmount },
                },
            });

            return { payment, gatewayOrder };
        } finally {
            await releasePaymentLock(lockKey);
        }
    },

    async createFinalPayment(orderId: string) {
        await assertOnlinePaymentsEnabled();

        const lockKey = `${orderId}:final`;
        const locked = await acquirePaymentLock(lockKey);
        if (!locked) throw new Error("Payment initiation already in progress, please wait");

        try {
            const order = await db.order.findUnique({
                where: { id: orderId },
                include: { payments: true },
            });
            if (!order) throw new Error("Order not found");

            const advancePaid = order.payments.find((p) => p.type === "ADVANCE" && p.status === "PAID");
            if (!advancePaid) throw new Error("Advance payment not completed");

            const existingFinal = order.payments.find((p) => p.type === "FINAL" && p.status !== "FAILED");
            if (existingFinal) throw new Error("Final payment already initiated");

            const baseAmount = Number(order.finalAmount ?? order.totalAmount);
            const finalAmount = parseFloat((baseAmount - Number(advancePaid.amount)).toFixed(2));

            const gateway = PaymentFactory.get();
            const gatewayOrder = await gateway.createOrder({
                amount: finalAmount,
                currency: "INR",
                receipt: `final_${orderId}`,
                notes: { orderId, type: "FINAL" },
            });

            const payment = await db.payment.create({
                data: {
                    orderId,
                    razorpayOrderId: gatewayOrder.gatewayOrderId,
                    amount: finalAmount,
                    type: "FINAL",
                    status: "UNPAID",
                    metadata: { baseAmount, advancePaid: Number(advancePaid.amount) },
                },
            });

            return { payment, gatewayOrder };
        } finally {
            await releasePaymentLock(lockKey);
        }
    },

    /**
     * @param requester Server-derived identity of the caller (never take
     * these from the request body). orderId in `data` is checked against
     * the payment's actual order, and the requester must own that order
     * valid Razorpay signature.
     */
    async verifyAndCapturePayment(
        data: {
            orderId: string;
            razorpayOrderId: string;
            razorpayPaymentId: string;
            razorpaySignature: string;
        },
        requester: { userId?: string; sellerId?: string },
    ) {
        const gateway = PaymentFactory.get();
        const isValid = await gateway.verifyPayment({
            gatewayOrderId: data.razorpayOrderId,
            gatewayPaymentId: data.razorpayPaymentId,
            signature: data.razorpaySignature,
        });
        if (!isValid) throw new Error("Invalid payment signature");

        const payment = await db.payment.findUnique({
            where: { razorpayOrderId: data.razorpayOrderId },
            include: { order: { include: { payments: true } } },
        });
        if (!payment) throw new Error("Payment record not found");
        if (payment.orderId !== data.orderId) {
            throw new Error("Payment does not belong to this order");
        }

        const isCustomer = requester.userId && payment.order.customerId === requester.userId;
        const isOwningSeller = requester.sellerId && payment.order.sellerId === requester.sellerId;
        if (!isCustomer && !isOwningSeller) {
            throw new Error("Order not found");
        }

        if (payment.status === "PAID") {
            return payment;
        }

        const updated = await db.$transaction(async (tx) => {
            const result = await tx.payment.updateMany({
                where: { id: payment.id, status: { not: "PAID" } },
                data: { razorpayPaymentId: data.razorpayPaymentId, status: "PAID" },
            });
            if (result.count === 0) {
                return null;
            }

            const totalPaid = payment.order.payments
                .filter((p) => p.id !== payment.id)
                .concat({ ...payment, status: "PAID" })
                .filter((p) => p.status === "PAID")
                .reduce((sum, p) => sum + Number(p.amount), 0);

            const baseAmount = Number(payment.order.finalAmount ?? payment.order.totalAmount);
            const isFullyPaid = Math.abs(totalPaid - baseAmount) < 0.01;

            await tx.order.update({
                where: { id: payment.orderId },
                data: { paymentStatus: isFullyPaid ? "PAID" : "PARTIALLY_PAID" },
            });

            await tx.auditLog.create({
                data: {
                    sellerId: payment.order.sellerId,
                    actorId: payment.orderId,
                    actorType: "system",
                    action: "PAYMENT_CAPTURED",
                    entityType: "payment",
                    entityId: payment.id,
                    metadata: { gatewayPaymentId: data.razorpayPaymentId, amount: Number(payment.amount), type: payment.type },
                },
            });

            return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        });

        if (updated) {
            await notifyPaymentReceived(payment.orderId, Number(payment.amount));

            return updated;
        }

        return db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    },

    async handleWebhook(payload: Buffer | string, signature: string) {
        const gateway = PaymentFactory.get();
        const result = await gateway.handleWebhook(payload, signature);

        logger.info({ event: result.event }, "Payment webhook received");

        switch (result.status) {
            case "captured": {
                if (!result.gatewayOrderId) break;
                const payment = await db.payment.findUnique({
                    where: { razorpayOrderId: result.gatewayOrderId },
                    include: { order: { include: { payments: true } } },
                });
                if (!payment || payment.status === "PAID") break;

                const captured = await db.$transaction(async (tx) => {
                    const updateResult = await tx.payment.updateMany({
                        where: { id: payment.id, status: { not: "PAID" } },
                        data: { razorpayPaymentId: result.gatewayPaymentId, status: "PAID" },
                    });
                    if (updateResult.count === 0) return false;

                    const totalPaid = payment.order.payments
                        .filter((p) => p.id !== payment.id)
                        .concat({ ...payment, status: "PAID" })
                        .filter((p) => p.status === "PAID")
                        .reduce((sum, p) => sum + Number(p.amount), 0);

                    const baseAmount = Number(payment.order.finalAmount ?? payment.order.totalAmount);
                    const isFullyPaid = Math.abs(totalPaid - baseAmount) < 0.01;

                    await tx.order.update({
                        where: { id: payment.orderId },
                        data: { paymentStatus: isFullyPaid ? "PAID" : "PARTIALLY_PAID" },
                    });
                    return true;
                });

                if (captured) {
                    await notifyPaymentReceived(payment.orderId, Number(payment.amount));
                }
                break;
            }

            case "failed": {
                if (!result.gatewayOrderId) break;
                await db.payment.updateMany({
                    where: { razorpayOrderId: result.gatewayOrderId, status: { not: "PAID" } },
                    data: { status: "FAILED", attempts: { increment: 1 } },
                });
                break;
            }

            case "refunded": {
                if (!result.gatewayPaymentId) break;
                const payment = await db.payment.findFirst({
                    where: { razorpayPaymentId: result.gatewayPaymentId },
                });
                if (!payment || payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") break;

                const isFullRefund = Math.abs((result.amount ?? 0) - Number(payment.amount)) < 0.01;
                await db.$transaction(async (tx) => {
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: {
                            refundId: result.refundId,
                            refundAmount: result.amount,
                            status: isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED",
                        },
                    });
                    await tx.order.update({
                        where: { id: payment.orderId },
                        data: { paymentStatus: isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED" },
                    });
                });
                break;
            }
        }

        return { received: true };
    },

    async initiateRefund(orderId: string, actorId: string, reason: string = "Order cancelled") {
        const lockKey = `${orderId}:refund`;
        const locked = await acquirePaymentLock(lockKey);
        if (!locked) throw new Error("Refund already in progress, please wait");

        try {
            const order = await db.order.findUnique({ where: { id: orderId }, include: { payments: true } });
            if (!order) throw new Error("Order not found");
            if (order.status !== "CANCELLED" && order.status !== "RETURNED") {
                throw new Error("Order must be cancelled or returned first");
            }

            const paidPayments = order.payments.filter((p) => p.status === "PAID");
            if (!paidPayments.length) throw new Error("No payments to refund");

            const gateway = PaymentFactory.get();
            const results = [];

            for (const payment of paidPayments) {
                if (!payment.razorpayPaymentId) continue;

                const claimed = await claimRefund(payment.id);
                if (!claimed) {
                    logger.warn({ paymentId: payment.id }, "Refund already claimed, skipping check for a stuck in-flight refund");
                    continue;
                }

                await db.auditLog.create({
                    data: {
                        sellerId: order.sellerId,
                        actorId,
                        actorType: "system",
                        action: "REFUND_INITIATING",
                        entityType: "payment",
                        entityId: payment.id,
                        metadata: { orderId, amount: Number(payment.amount) },
                    },
                });

                try {
                    const refund = await gateway.initiateRefund({
                        gatewayPaymentId: payment.razorpayPaymentId,
                        amount: Number(payment.amount),
                        notes: { orderId, reason, actorId },
                    });

                    await db.payment.update({
                        where: { id: payment.id },
                        data: { refundId: refund.refundId, status: "REFUNDED", refundAmount: refund.amount },
                    });

                    await db.auditLog.create({
                        data: {
                            sellerId: order.sellerId,
                            actorId,
                            actorType: "system",
                            action: "REFUND_COMPLETED",
                            entityType: "payment",
                            entityId: payment.id,
                            metadata: { orderId, refundId: refund.refundId, amount: refund.amount },
                        },
                    });

                    results.push({ paymentId: payment.id, refundId: refund.refundId });
                } catch (err: any) {
                    logger.error(
                        { err: err.message, paymentId: payment.id, orderId },
                        "Refund failed after REFUND_INITIATING was logged: reconcile against gateway before retrying, gateway call may have partially succeeded"
                    );
                }
            }

            await db.auditLog.create({
                data: {
                    sellerId: order.sellerId,
                    actorId,
                    actorType: "system",
                    action: "REFUND_INITIATED",
                    entityType: "order",
                    entityId: orderId,
                    metadata: { refunds: results },
                },
            });

            return results;
        } finally {
            await releasePaymentLock(lockKey);
        }
    },

    async getPayments(orderId: string) {
        return db.payment.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
    },

    async recordManualPayment(
        orderId: string,
        actorId: string,
        data: { type: "ADVANCE" | "FINAL"; amount: number; note?: string },
    ) {
        const order = await db.order.findUnique({
            where: { id: orderId },
            include: { payments: true },
        });
        if (!order) throw new Error("Order not found");

        if (data.type === "ADVANCE") {
            if (!["CONFIRMED"].includes(order.status)) {
                throw new Error("Order not in payable state");
            }
            const existingAdvance = order.payments.find((p) => p.type === "ADVANCE" && p.status !== "FAILED");
            if (existingAdvance) throw new Error("Advance payment already initiated");
        } else {
            const advancePaid = order.payments.find((p) => p.type === "ADVANCE" && p.status === "PAID");
            if (!advancePaid) throw new Error("Advance payment not completed");
            const existingFinal = order.payments.find((p) => p.type === "FINAL" && p.status !== "FAILED");
            if (existingFinal) throw new Error("Final payment already initiated");
        }

        const payment = await db.$transaction(async (tx) => {
            const created = await tx.payment.create({
                data: {
                    orderId,
                    amount: data.amount,
                    type: data.type,
                    status: "PAID",
                    method: "CASH",
                    recordedByActorId: actorId,
                    note: data.note,
                },
            });

            const totalPaid = order.payments
                .filter((p) => p.status === "PAID")
                .reduce((sum, p) => sum + Number(p.amount), 0) + data.amount;
            const baseAmount = Number(order.finalAmount ?? order.totalAmount);
            const isFullyPaid = Math.abs(totalPaid - baseAmount) < 0.01;

            await tx.order.update({
                where: { id: orderId },
                data: { paymentStatus: isFullyPaid ? "PAID" : "PARTIALLY_PAID" },
            });

            await tx.auditLog.create({
                data: {
                    sellerId: order.sellerId,
                    actorId,
                    actorType: "platform",
                    action: "PAYMENT_RECORDED_MANUAL",
                    entityType: "payment",
                    entityId: created.id,
                    metadata: { orderId, type: data.type, amount: data.amount, note: data.note ?? null },
                },
            });

            return created;
        });

        await notifyPaymentReceived(orderId, data.amount);
        return payment;
    },

    async getOnlinePaymentsEnabled(): Promise<boolean> {
        return getPlatformConfigBool(ONLINE_PAYMENTS_CONFIG_KEY, true);
    },

    async setOnlinePaymentsEnabled(enabled: boolean, actorId: string): Promise<{ enabled: boolean }> {
        await db.platformConfig.upsert({
            where: { key: ONLINE_PAYMENTS_CONFIG_KEY },
            update: { value: encrypt(String(enabled)) },
            create: { key: ONLINE_PAYMENTS_CONFIG_KEY, value: encrypt(String(enabled)) },
        });

        await db.auditLog.create({
            data: {
                actorId,
                actorType: "platform",
                action: "PLATFORM_CONFIG_UPDATED",
                entityType: "platform_config",
                entityId: ONLINE_PAYMENTS_CONFIG_KEY,
                metadata: { key: ONLINE_PAYMENTS_CONFIG_KEY, enabled },
            },
        });

        return { enabled };
    },

    async getOrderAccessInfo(orderId: string) {
        return db.order.findUnique({
            where: { id: orderId },
            select: { customerId: true, sellerId: true },
        });
    },
};
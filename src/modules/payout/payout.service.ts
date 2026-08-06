import { db } from "../../db/index";
import { redis } from "../../db/redis";
import { decrypt, encrypt } from "../../utils/encryption";
import { PayoutFactory } from "../../lib/payouts/payout.factory";
import { notificationService } from "../notification/notification.service";
import { logger } from "../../utils/logger";
import { triggerAnalyticsRefresh } from "../../lib/analytics/analytics.events";
import { getPlatformConfig } from "../../lib/platform-config/platform-config";
import { maskAccountNumber } from "../../utils/mask";

const PAYOUT_LOCK_TTL = 30;

async function acquirePayoutLock(sellerId: string): Promise<boolean> {
    const result = await redis.set(`payout:lock:${sellerId}`, "1", "EX", PAYOUT_LOCK_TTL, "NX");
    return result === "OK";
}

async function releasePayoutLock(sellerId: string): Promise<void> {
    await redis.del(`payout:lock:${sellerId}`);
}

async function getPayoutProvider() {
    const [keyId, keySecret, sourceAccountNumber] = await Promise.all([
        getPlatformConfig("razorpay_key_id"),
        getPlatformConfig("razorpay_key_secret"),
        getPlatformConfig("razorpay_account_number"),
    ]);
    return PayoutFactory.get(keyId, keySecret, sourceAccountNumber);
}

async function getSellerOwner(sellerId: string) {
    return db.sellerMember.findFirst({
        where: { sellerId, role: { name: "owner" }, isActive: true },
        select: { userId: true, user: { select: { email: true, name: true } } },
    });
}

export const payoutService = {
    async setPlatformConfig(key: string, value: string, actorId: string) {
        const encrypted = encrypt(value);
        const config = await db.platformConfig.upsert({
            where: { key },
            update: { value: encrypted },
            create: { key, value: encrypted },
        });

        await db.auditLog.create({
            data: {
                actorId,
                actorType: "platform",
                action: "PLATFORM_CONFIG_UPDATED",
                entityType: "platform_config",
                entityId: config.id,
                metadata: { key },
            },
        });

        return { key: config.key, updatedAt: config.updatedAt };
    },

    async getSellerPayoutSummary(sellerId: string) {
        const seller = await db.seller.findUnique({
            where: { id: sellerId },
            select: {
                id: true, name: true, businessName: true, email: true,
                bankDetail: {
                    select: {
                        accountHolderName: true,
                        ifscCode: true,
                        bankName: true,
                        accountNumber: true,
                    },
                },
            },
        });
        if (!seller) throw new Error("Seller not found");

        const unpaidOrders = await db.order.findMany({
            where: {
                sellerId,
                status: "DELIVERED",
                paymentStatus: "PAID",
                payoutOrders: { none: {} },
            },
            select: {
                id: true,
                totalAmount: true,
                finalAmount: true,
                commissionAmount: true,
                createdAt: true,
            },
        });

        const grossAmount = unpaidOrders.reduce(
            (sum, o) => sum + Number(o.finalAmount ?? o.totalAmount),
            0
        );
        const commissionAmount = unpaidOrders.reduce(
            (sum, o) => sum + Number(o.commissionAmount ?? 0),
            0
        );
        const netAmount = grossAmount - commissionAmount;

        return {
            seller: {
                ...seller,
                bankDetail: seller.bankDetail
                    ? {
                        ...seller.bankDetail,
                        accountNumber: maskAccountNumber(decrypt(seller.bankDetail.accountNumber)),
                    }
                    : null,
            },
            unpaidOrders,
            grossAmount,
            commissionAmount,
            netAmount,
        };
    },

    async listAllSellersSummary() {
        const sellers = await db.seller.findMany({
            where: { status: "APPROVED" },
            select: { id: true, name: true, businessName: true, email: true },
        });

        const sellerIds = sellers.map((s) => s.id);

        const [counts, aggregates] = await Promise.all([
            db.order.groupBy({
                by: ["sellerId"],
                where: {
                    sellerId: { in: sellerIds },
                    status: "DELIVERED",
                    paymentStatus: "PAID",
                    payoutOrders: { none: {} },
                },
                _count: { id: true },
            }),
            db.order.groupBy({
                by: ["sellerId"],
                where: {
                    sellerId: { in: sellerIds },
                    status: "DELIVERED",
                    paymentStatus: "PAID",
                    payoutOrders: { none: {} },
                },
                _sum: { finalAmount: true, totalAmount: true, commissionAmount: true },
            }),
        ]);

        const countMap = new Map(counts.map((c) => [c.sellerId, c._count.id]));
        const aggMap = new Map(aggregates.map((a) => [a.sellerId, a._sum]));

        const summaries = sellers.map((seller) => {
            const unpaidOrderCount = countMap.get(seller.id) ?? 0;
            const sums = aggMap.get(seller.id);
            const gross = Number(sums?.finalAmount ?? sums?.totalAmount ?? 0);
            const commission = Number(sums?.commissionAmount ?? 0);

            return {
                ...seller,
                unpaidOrderCount,
                grossAmount: gross,
                commissionAmount: commission,
                netAmount: gross - commission,
            };
        });

        return summaries.filter((s) => s.unpaidOrderCount > 0);
    },

    async initiatePayout(
        sellerId: string,
        actorId: string,
        data: {
            method: "UPI" | "IMPS" | "RTGS" | "NEFT";
            note?: string;
            periodStart?: string;
            periodEnd?: string;
        }
    ) {
        const locked = await acquirePayoutLock(sellerId);
        if (!locked) throw new Error("Payout already in progress for this seller, please wait");

        try {
            const seller = await db.seller.findUnique({
                where: { id: sellerId },
                include: { bankDetail: true },
            });
            if (!seller) throw new Error("Seller not found");
            if (!seller.bankDetail) throw new Error("Seller bank details not found");
            if (seller.bankDetail.verificationStatus !== "VERIFIED") {
                throw new Error(
                    `Seller bank account is not verified (status: ${seller.bankDetail.verificationStatus}) - cannot initiate payout`
                );
            }

            const unpaidOrders = await db.order.findMany({
                where: {
                    sellerId,
                    status: "DELIVERED",
                    paymentStatus: "PAID",
                    payoutOrders: { none: {} },
                    ...(data.periodStart && data.periodEnd && {
                        createdAt: {
                            gte: new Date(data.periodStart),
                            lte: new Date(data.periodEnd),
                        },
                    }),
                },
                select: {
                    id: true,
                    totalAmount: true,
                    finalAmount: true,
                    commissionAmount: true,
                },
            });

            if (!unpaidOrders.length) throw new Error("No unpaid orders to payout");

            const grossAmount = unpaidOrders.reduce(
                (sum, o) => sum + Number(o.finalAmount ?? o.totalAmount),
                0
            );
            const commissionAmount = unpaidOrders.reduce(
                (sum, o) => sum + Number(o.commissionAmount ?? 0),
                0
            );
            const netAmount = grossAmount - commissionAmount;

            if (netAmount <= 0) throw new Error("Net payout amount must be greater than 0");

            const provider = await getPayoutProvider();

            let fundAccountId = seller.bankDetail.fundAccountId;
            if (!fundAccountId) {
                const accountNumber = decrypt(seller.bankDetail.accountNumber);
                const fundAccount = await provider.createFundAccount({
                    accountHolderName: seller.bankDetail.accountHolderName,
                    accountNumber,
                    ifscCode: seller.bankDetail.ifscCode,
                    bankName: seller.bankDetail.bankName,
                    contactName: seller.name,
                    contactEmail: seller.email,
                    contactPhone: seller.phone,
                });
                fundAccountId = fundAccount.fundAccountId;
            }

            const payout = await db.$transaction(async (tx) => {
                const created = await tx.sellerPayout.create({
                    data: {
                        sellerId,
                        grossAmount,
                        commissionAmount,
                        netAmount,
                        method: data.method,
                        fundAccountId,
                        status: "PENDING",
                        initiatedBy: actorId,
                        note: data.note,
                        periodStart: data.periodStart ? new Date(data.periodStart) : null,
                        periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
                        orders: {
                            create: unpaidOrders.map((o) => ({
                                orderId: o.id,
                                orderAmount: Number(o.finalAmount ?? o.totalAmount),
                                commissionAmount: Number(o.commissionAmount ?? 0),
                                netAmount:
                                    Number(o.finalAmount ?? o.totalAmount) - Number(o.commissionAmount ?? 0),
                            })),
                        },
                    },
                });

                await tx.auditLog.create({
                    data: {
                        sellerId,
                        actorId,
                        actorType: "platform",
                        action: "PAYOUT_INITIATED",
                        entityType: "seller_payout",
                        entityId: created.id,
                        metadata: { grossAmount, commissionAmount, netAmount, method: data.method },
                    },
                });

                return created;
            });

            try {
                const result = await provider.createPayout({
                    fundAccountId,
                    amount: netAmount,
                    currency: "INR",
                    mode: data.method,
                    refId: payout.id,
                    narration: `Payout for ${seller.businessName}`,
                });

                await db.sellerPayout.update({
                    where: { id: payout.id },
                    data: {
                        razorpayPayoutId: result.razorpayPayoutId,
                        status: result.status === "processed" ? "PAID"
                            : result.status === "failed" ? "FAILED"
                                : result.status === "queued" ? "QUEUED"
                                    : "PROCESSING",
                        utrReference: result.utrRef,
                        paidAt: result.status === "processed" ? new Date() : null,
                    },
                });
            } catch (err: any) {
                await db.sellerPayout.update({
                    where: { id: payout.id },
                    data: { status: "FAILED", failureReason: err.message },
                });
                logger.error({ err: err.message, payoutId: payout.id },
                    "Payout initiation failed orders remain claimed under this payout for manual investigation/retry",
                );}

            const owner = await getSellerOwner(sellerId);
            if (owner) {
                notificationService.notify({
                    userId: owner.userId,
                    email: owner.user.email,
                    type: "PAYOUT_INITIATED",
                    title: "Payout initiated",
                    message: `A payout of ₹${netAmount.toFixed(2)} has been initiated for ${seller.businessName}.`,
                    channels: ["email", "sse"],
                    data: { payoutId: payout.id, netAmount },
                }).catch(() => null);
            }

            return db.sellerPayout.findUnique({
                where: { id: payout.id },
                include: { orders: true },
            });
        } finally {
            await releasePayoutLock(sellerId);
        }
    },

    async handleWebhook(payload: Buffer | string, signature: string) {
        const [provider, webhookSecret] = await Promise.all([
            getPayoutProvider(),
            getPlatformConfig("razorpay_payout_webhook_secret"),
        ]);
        const result = await provider.handleWebhook(payload, signature, webhookSecret);

        logger.info({ razorpayPayoutId: result.razorpayPayoutId, status: result.status }, "Payout webhook received");

        const payout = await db.sellerPayout.findUnique({
            where: { razorpayPayoutId: result.razorpayPayoutId },
            include: { seller: true },
        });
        if (!payout) return { received: true };

        const statusMap: Record<string, string> = {
            processed: "PAID",
            failed: "FAILED",
            queued: "QUEUED",
            cancelled: "FAILED",
        };

        const newStatus = statusMap[result.status] ?? "PROCESSING";


        if (payout.status === newStatus) {
            return { received: true };
        }

        await db.sellerPayout.update({
            where: { id: payout.id },
            data: {
                status: newStatus as any,
                utrReference: result.utrRef ?? payout.utrReference,
                failureReason: result.failureReason,
                paidAt: result.status === "processed" ? new Date() : null,
            },
        });

        const owner = await getSellerOwner(payout.sellerId);
        if (owner) {
            const notifType = result.status === "processed" ? "PAYOUT_PAID" : "PAYOUT_FAILED";
            const title = result.status === "processed" ? "Payout successful" : "Payout failed";
            const message = result.status === "processed"
                ? `₹${Number(payout.netAmount).toFixed(2)} has been transferred to your bank account. UTR: ${result.utrRef}`
                : `Payout of ₹${Number(payout.netAmount).toFixed(2)} failed. Reason: ${result.failureReason}`;

            notificationService.notify({
                userId: owner.userId,
                email: owner.user.email,
                type: notifType as any,
                title,
                message,
                channels: ["email", "sse"],
                data: { payoutId: payout.id, utrRef: result.utrRef },
            }).catch(() => null);
        }

        if (result.status === "processed") {
            triggerAnalyticsRefresh("PAYOUT_PAID", payout.sellerId).catch(() => null);
        }
        return { received: true };
    },

    async getPayoutHistory(
        sellerId?: string,
        filters?: { status?: string; search?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }
    ) {
        const page = filters?.page ?? 1;
        const limit = Math.min(filters?.limit ?? 20, 100);

        const where: any = sellerId ? { sellerId } : {};
        if (filters?.status) where.status = filters.status;
        if (filters?.dateFrom || filters?.dateTo) {
            where.createdAt = {};
            if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
            if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
        }
        if (filters?.search) {
            where.OR = [
                { id: { contains: filters.search, mode: "insensitive" } },
                { utrReference: { contains: filters.search, mode: "insensitive" } },
            ];
        }

        const [data, total] = await Promise.all([
            db.sellerPayout.findMany({
                where,
                select: {
                    id: true, grossAmount: true, commissionAmount: true, netAmount: true,
                    method: true, status: true, utrReference: true, paidAt: true, createdAt: true,
                    note: true, periodStart: true, periodEnd: true,
                    seller: { select: { id: true, name: true, businessName: true } },
                    orders: { select: { orderId: true, netAmount: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.sellerPayout.count({ where }),
        ]);

        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
    },
    async getPayoutConfig() {
        const configs = await db.platformConfig.findMany({
            where: { key: { in: ["razorpay_key_id", "razorpay_payout_webhook_secret", "razorpay_account_number"] } },
            select: { key: true, updatedAt: true },
        });

        const configured = new Set(configs.map(c => c.key));

        return {
            razorpayKeyIdConfigured: configured.has("razorpay_key_id"),
            razorpayWebhookSecretConfigured: configured.has("razorpay_payout_webhook_secret"),
            razorpayAccountNumberConfigured: configured.has("razorpay_account_number"),
            lastUpdated: configs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]?.updatedAt ?? null,
        };
    },
    async getPayoutById(payoutId: string) {
        const payout = await db.sellerPayout.findUnique({
            where: { id: payoutId },
            include: {
                seller: { select: { id: true, name: true, businessName: true, email: true } },
                orders: {
                    include: {
                        order: { select: { id: true, displayId: true, type: true, totalAmount: true, finalAmount: true } },
                    },
                },
            },
        });
        if (!payout) throw new Error("Payout not found");
        return payout;
    },

    async getMyPayoutById(sellerId: string, payoutId: string) {
        const payout = await db.sellerPayout.findFirst({
            where: { id: payoutId, sellerId },
            include: {
                seller: { select: { id: true, name: true, businessName: true, email: true } },
                orders: {
                    include: {
                        order: { select: { id: true, displayId: true, type: true, totalAmount: true, finalAmount: true } },
                    },
                },
            },
        });
        if (!payout) throw new Error("Payout not found");
        return payout;
    },
    async exportPayoutsCsv(sellerId: string) {
        return db.sellerPayout.findMany({
            where: { sellerId },
            select: { id: true, grossAmount: true, commissionAmount: true, netAmount: true, method: true, status: true, utrReference: true, createdAt: true },
            orderBy: { createdAt: "desc" },
        });
    },
};
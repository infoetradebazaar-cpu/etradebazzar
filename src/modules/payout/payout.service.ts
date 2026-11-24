import { db } from "../../db/index";
import { Prisma } from "../../../prisma/generated/client";
import { redis } from "../../db/redis";
import { decrypt, encrypt } from "../../utils/encryption";
import { PayoutFactory } from "../../lib/payouts/payout.factory";
import { notificationService } from "../notification/notification.service";
import { logger } from "../../utils/logger";
import { triggerAnalyticsRefresh } from "../../lib/analytics/analytics.events";
import { getPlatformConfig, invalidatePlatformConfig } from "../../lib/platform-config/platform-config";
import { maskAccountNumber } from "../../utils/mask";
import { config } from "../../../config/config";
import { acquireLock, releaseLock } from "../../lib/locks/redis-lock";

const PAYOUT_LOCK_TTL = 120;

async function acquirePayoutLock(sellerId: string): Promise<string | null> {
  return acquireLock(`payout:lock:${sellerId}`, PAYOUT_LOCK_TTL);
}

async function releasePayoutLock(sellerId: string, token: string): Promise<void> {
  await releaseLock(`payout:lock:${sellerId}`, token);
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

const PROVIDER_TO_PAYOUT_STATUS = {
    processed: "PAID",
    failed: "FAILED",
    cancelled: "FAILED",
    queued: "QUEUED",
    pending: "PROCESSING",
    processing: "PROCESSING",
} as const;

async function handleCreatePayoutError(payoutId: string, err: Error & { httpStatus?: number }) {
    const definite = err.httpStatus !== undefined && err.httpStatus >= 400 && err.httpStatus < 500;
    if (definite) {
        await failPayoutAndReleaseOrders(payoutId, err.message);
        logger.error({ err: err.message, payoutId }, "Payout rejected by RazorpayX; orders released for the next payout");
    } else {
        await db.sellerPayout.update({
            where: { id: payoutId },
            data: { status: "PROCESSING", failureReason: `Outcome unknown, run sync: ${err.message}` },
        });
        logger.error({ err: err.message, payoutId }, "Payout outcome unknown; left PROCESSING for sync/webhook");
    }
}

async function failPayoutAndReleaseOrders(payoutId: string, failureReason: string | null) {
    await db.$transaction(async (tx) => {
        const claimed = await tx.sellerPayout.updateMany({
            where: { id: payoutId, status: { not: "PAID" } },
            data: { status: "FAILED", failureReason },
        });
        if (claimed.count === 0) return;
        await tx.payoutOrder.deleteMany({ where: { payoutId } });
    });
}

async function applyPayoutStatus(
    payout: { id: string; sellerId: string; status: string; netAmount: unknown; utrReference: string | null },
    providerStatus: keyof typeof PROVIDER_TO_PAYOUT_STATUS,
    utrRef: string | null,
    failureReason: string | null,
) {
    const newStatus = PROVIDER_TO_PAYOUT_STATUS[providerStatus] ?? "PROCESSING";
    if (payout.status === newStatus || payout.status === "PAID") return;

    if (newStatus === "FAILED") {
        await failPayoutAndReleaseOrders(payout.id, failureReason);
    } else {
        await db.sellerPayout.update({
            where: { id: payout.id },
            data: {
                status: newStatus,
                utrReference: utrRef ?? payout.utrReference,
                failureReason,
                paidAt: newStatus === "PAID" ? new Date() : null,
            },
        });
    }

    if (newStatus !== "PAID" && newStatus !== "FAILED") return;
    const paid = newStatus === "PAID";
    const owner = await getSellerOwner(payout.sellerId);
    if (owner) {
        notificationService.notify({
            userId: owner.userId,
            email: owner.user.email,
            type: paid ? "PAYOUT_PAID" : "PAYOUT_FAILED",
            title: paid ? "Payout successful" : "Payout failed",
            message: paid
                ? `₹${Number(payout.netAmount).toFixed(2)} has been transferred to your bank account. UTR: ${utrRef}`
                : `Payout of ₹${Number(payout.netAmount).toFixed(2)} failed. Reason: ${failureReason}`,
            channels: ["email", "sse"],
            emailTemplate: paid ? "payout-paid" : "payout-failed",
            emailData: paid
                ? {
                    sellerName: owner.user.name ?? "there",
                    netAmount: Number(payout.netAmount),
                    utrRef,
                    payoutUrl: `${config.sellerAppUrl}/payouts/${payout.id}`,
                }
                : {
                    sellerName: owner.user.name ?? "there",
                    netAmount: Number(payout.netAmount),
                    failureReason,
                    payoutUrl: `${config.sellerAppUrl}/payouts/${payout.id}`,
                },
            data: { payoutId: payout.id, utrRef },
        }).catch(() => null);
    }
    if (paid) triggerAnalyticsRefresh("PAYOUT_PAID", payout.sellerId).catch(() => null);
}

export const payoutService = {
    async setPlatformConfig(key: string, value: string, actorId: string) {
        const encrypted = encrypt(value);
        const config = await db.platformConfig.upsert({
            where: { key },
            update: { value: encrypted },
            create: { key, value: encrypted },
        });
        invalidatePlatformConfig(key);

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

        const rows = sellerIds.length
            ? await db.$queryRaw<{ sellerId: string; n: number; gross: string; commission: string }[]>`
                SELECT o."sellerId",
                       COUNT(*)::int AS n,
                       SUM(COALESCE(o."finalAmount", o."totalAmount")) AS gross,
                       SUM(COALESCE(o."commissionAmount", 0)) AS commission
                FROM orders o
                WHERE o."sellerId" IN (${Prisma.join(sellerIds)})
                  AND o.status = 'DELIVERED' AND o."paymentStatus" = 'PAID'
                  AND NOT EXISTS (SELECT 1 FROM payout_orders po WHERE po."orderId" = o.id)
                GROUP BY o."sellerId"`
            : [];
        const bySeller = new Map(rows.map((r) => [r.sellerId, r]));

        const summaries = sellers.map((seller) => {
            const row = bySeller.get(seller.id);
            const unpaidOrderCount = row?.n ?? 0;
            const gross = Number(row?.gross ?? 0);
            const commission = Number(row?.commission ?? 0);

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
            periodStart: string;
            periodEnd: string;
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

            const periodStart = new Date(data.periodStart);
            const periodEnd = new Date(data.periodEnd);

            const overlapping = await db.sellerPayout.findFirst({
                where: {
                    sellerId,
                    status: { not: "FAILED" },
                    periodStart: { lt: periodEnd },
                    periodEnd: { gt: periodStart },
                },
                select: { id: true, periodStart: true, periodEnd: true, status: true },
            });
            if (overlapping) {
                throw new Error(
                    `Requested period overlaps an existing payout (${overlapping.id}, ${overlapping.periodStart?.toISOString()} - ${overlapping.periodEnd?.toISOString()}, status ${overlapping.status})`,
                );
            }

            const unpaidOrders = await db.order.findMany({
                where: {
                    sellerId,
                    status: "DELIVERED",
                    paymentStatus: "PAID",
                    payoutOrders: { none: {} },
                    createdAt: { gte: periodStart, lte: periodEnd },
                },
                select: {
                    id: true,
                    totalAmount: true,
                    finalAmount: true,
                    commissionAmount: true,
                },
            });

            if (!unpaidOrders.length) throw new Error("No unpaid orders to payout in this period");

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
                await db.sellerBankDetail.update({
                    where: { id: seller.bankDetail.id },
                    data: { fundAccountId },
                });
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
                        periodStart,
                        periodEnd,
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
                await handleCreatePayoutError(payout.id, err);
            }

            const owner = await getSellerOwner(sellerId);
            if (owner) {
                notificationService.notify({
                    userId: owner.userId,
                    email: owner.user.email,
                    type: "PAYOUT_INITIATED",
                    title: "Payout initiated",
                    message: `A payout of ₹${netAmount.toFixed(2)} has been initiated for ${seller.businessName}.`,
                    channels: ["email", "sse"],
                    emailTemplate: "payout-initiated",
                    emailData: {
                        sellerName: owner.user.name ?? "there",
                        businessName: seller.businessName,
                        netAmount,
                        payoutUrl: `${config.sellerAppUrl}/payouts/${payout.id}`,
                    },
                    data: { payoutId: payout.id, netAmount },
                }).catch(() => null);
            }

            return db.sellerPayout.findUnique({
                where: { id: payout.id },
                include: { orders: true },
            });
        } finally {
            await releasePayoutLock(sellerId, locked);
        }
    },

    async handleWebhook(payload: Buffer | string, signature: string) {
        const [provider, webhookSecret] = await Promise.all([
            getPayoutProvider(),
            getPlatformConfig("razorpay_payout_webhook_secret"),
        ]);
        const result = await provider.handleWebhook(payload, signature, webhookSecret);

        logger.info({ razorpayPayoutId: result.razorpayPayoutId, status: result.status }, "Payout webhook received");

        let payout = await db.sellerPayout.findUnique({
            where: { razorpayPayoutId: result.razorpayPayoutId },
        });
        if (!payout && result.referenceId) {
            payout = await db.sellerPayout.findFirst({
                where: { id: result.referenceId, razorpayPayoutId: null },
            });
            if (payout) {
                payout = await db.sellerPayout.update({
                    where: { id: payout.id },
                    data: { razorpayPayoutId: result.razorpayPayoutId },
                });
            }
        }
        if (!payout) return { received: true };

        await applyPayoutStatus(payout, result.status, result.utrRef, result.failureReason);
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

    async syncPayout(payoutId: string) {
        const payout = await db.sellerPayout.findUnique({ where: { id: payoutId } });
        if (!payout) throw new Error("Payout not found");
        if (payout.status === "PAID" || payout.status === "FAILED") return payout;

        const provider = await getPayoutProvider();
        let result;
        if (payout.razorpayPayoutId) {
            result = await provider.getPayout(payout.razorpayPayoutId);
        } else {
            if (!payout.fundAccountId) throw new Error("Payout has no fund account");
            try {
                result = await provider.createPayout({
                    fundAccountId: payout.fundAccountId,
                    amount: Number(payout.netAmount),
                    currency: "INR",
                    mode: payout.method,
                    refId: payout.id,
                    narration: "Seller payout",
                });
            } catch (err: any) {
                await handleCreatePayoutError(payout.id, err);
                return db.sellerPayout.findUnique({ where: { id: payoutId } });
            }
            await db.sellerPayout.update({
                where: { id: payout.id },
                data: { razorpayPayoutId: result.razorpayPayoutId },
            });
        }

        await applyPayoutStatus(payout, result.status, result.utrRef, null);
        return db.sellerPayout.findUnique({ where: { id: payoutId } });
    },

    async reconcilePayout(payoutId: string) {
        const payout = await db.sellerPayout.findUnique({
            where: { id: payoutId },
            include: {
                orders: {
                    include: {
                        order: {
                            select: {
                                id: true,
                                displayId: true,
                                status: true,
                                paymentStatus: true,
                                totalAmount: true,
                                finalAmount: true,
                                commissionAmount: true,
                                returnRequests: {
                                    select: { status: true, updatedAt: true },
                                    orderBy: { updatedAt: "desc" },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!payout) throw new Error("Payout not found");

        const lineItems = payout.orders.map((po) => {
            const order = po.order;
            const issues: string[] = [];

            const currentOrderAmount = Number(order.finalAmount ?? order.totalAmount);
            const currentCommission = Number(order.commissionAmount ?? 0);
            const currentNetAmount = currentOrderAmount - currentCommission;
            const frozenOrderAmount = Number(po.orderAmount);
            const frozenCommission = Number(po.commissionAmount);
            const frozenNetAmount = Number(po.netAmount);

            if (Math.abs(currentOrderAmount - frozenOrderAmount) > 0.01) {
                issues.push(`order amount changed since payout: was ${frozenOrderAmount}, now ${currentOrderAmount}`);
            }
            if (Math.abs(currentCommission - frozenCommission) > 0.01) {
                issues.push(`commission changed since payout: was ${frozenCommission}, now ${currentCommission}`);
            }
            if (order.status === "RETURNED" || order.status === "CANCELLED") {
                issues.push(`order status is now ${order.status} (was paid out while active)`);
            }
            if (order.paymentStatus === "REFUNDED" || order.paymentStatus === "PARTIALLY_REFUNDED") {
                issues.push(`payment status is now ${order.paymentStatus} (was PAID at payout time)`);
            }
            const latestReturn = order.returnRequests[0];
            if (latestReturn && ["APPROVED", "PICKED_UP", "COMPLETED"].includes(latestReturn.status)) {
                issues.push(`a return request is ${latestReturn.status} for this order`);
            }

            return {
                orderId: order.id,
                displayId: order.displayId,
                payoutOrderId: po.id,
                orderStatus: order.status,
                paymentStatus: order.paymentStatus,
                frozenNetAmount,
                currentNetAmount,
                hasDrift: issues.length > 0,
                issues,
            };
        });

        const driftedItems = lineItems.filter((li) => li.hasDrift);
        const atRiskAmount = driftedItems.reduce((sum, li) => sum + li.frozenNetAmount, 0);

        return {
            payoutId: payout.id,
            status: payout.status,
            netAmount: Number(payout.netAmount),
            periodStart: payout.periodStart,
            periodEnd: payout.periodEnd,
            totalOrders: lineItems.length,
            driftedOrderCount: driftedItems.length,
            atRiskAmount,
            hasDrift: driftedItems.length > 0,
            lineItems,
        };
    },
};
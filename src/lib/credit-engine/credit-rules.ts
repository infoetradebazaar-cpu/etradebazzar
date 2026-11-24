import { db } from "../../db/index";
import { redis } from "../../db/redis";
import { walletService } from "../../modules/wallet/wallet.service";
import { logger } from "../../utils/logger";
import { acquireLock, releaseLock } from "../locks/redis-lock";

export const CREDIT_RULES = {
    ONBOARDING_BONUS: 100,
    PROFILE_COMPLETION_BONUS: 50,
    ORDER_COMPLETION_CREDIT: 20,
    IMMEDIATE_CANCEL_PENALTY: 10,
    IMMEDIATE_CANCEL_WINDOW_MINUTES: 60,
};

const CREDIT_LOCK_TTL = 10;

async function alreadyAwarded(userId: string, reason: string): Promise<boolean> {
    const wallet = await db.wallet.findUnique({ where: { userId } });
    if (!wallet) return false;
    const existing = await db.walletTransaction.findFirst({ where: { walletId: wallet.id, reason } });
    return !!existing;
}

async function awardOnceWithLock(userId: string, reason: string, amount: number, referenceId?: string) {
    const lockKey = `credit-lock:${reason}:${userId}`;
    const locked = await acquireLock(lockKey, CREDIT_LOCK_TTL);
    if (!locked) return;
    try {
        if (await alreadyAwarded(userId, reason)) return;
        await walletService.credit(userId, amount, reason, referenceId ?? reason);
    } finally {
        await releaseLock(lockKey, locked);
    }
}

export const creditEngine = {
    async awardOnboardingBonus(userId: string) {
        try {
            await awardOnceWithLock(userId, "ONBOARDING_BONUS", CREDIT_RULES.ONBOARDING_BONUS);
        } catch (err: any) {
            logger.error({ err: err.message, userId }, "Onboarding credit failed");
        }
    },

    async checkProfileCompletion(userId: string) {
        try {
            const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
            const addressCount = await db.customerAddress.count({ where: { userId } });

            const isComplete = !!user?.name && addressCount > 0;
            if (!isComplete) return;

            await awardOnceWithLock(userId, "PROFILE_COMPLETION", CREDIT_RULES.PROFILE_COMPLETION_BONUS);
        } catch (err: any) {
            logger.error({ err: err.message, userId }, "Profile completion credit failed");
        }
    },

    async awardOrderCompletion(userId: string, orderId: string) {
        try {
            await walletService.credit(userId, CREDIT_RULES.ORDER_COMPLETION_CREDIT, "ORDER_COMPLETED", orderId);
        } catch (err: any) {
            logger.error({ err: err.message, userId, orderId }, "Order completion credit failed");
        }
    },

    async checkCancelPenalty(userId: string, orderId: string, orderCreatedAt: Date) {
        try {
            const minutesSinceCreation = (Date.now() - orderCreatedAt.getTime()) / (1000 * 60);
            if (minutesSinceCreation > CREDIT_RULES.IMMEDIATE_CANCEL_WINDOW_MINUTES) return;

            await walletService.debit(userId, CREDIT_RULES.IMMEDIATE_CANCEL_PENALTY, "IMMEDIATE_CANCEL_PENALTY", orderId);
        } catch (err: any) {
            logger.warn({ err: err.message, userId, orderId }, "Cancel penalty skipped");
        }
    },
};
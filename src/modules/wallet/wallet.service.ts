import { db } from "../../db/index";

async function ignoreDuplicateEntry<T>(walletId: string, write: () => Promise<T>) {
    try {
        return await write();
    } catch (err: any) {
        if (err?.code !== "P2002") throw err;
        return db.wallet.findUniqueOrThrow({ where: { id: walletId } });
    }
}

export const walletService = {
    async getOrCreateWallet(userId: string) {
        let wallet = await db.wallet.findUnique({ where: { userId } });
        if (!wallet) {
            try {
                wallet = await db.wallet.create({ data: { userId } });
            } catch (err: any) {
                if (err.code === "P2002") {
                    wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
                } else {
                    throw err;
                }
            }
        }
        return wallet;
    },

    async getBalance(userId: string) {
        const wallet = await this.getOrCreateWallet(userId);
        return { balance: Number(wallet.balance) };
    },

    async credit(userId: string, amount: number, reason: string, referenceId?: string) {
        if (amount <= 0) throw new Error("Credit amount must be positive");

        const wallet = await this.getOrCreateWallet(userId);
        return ignoreDuplicateEntry(wallet.id, () => db.$transaction(async (tx) => {
            const updated = await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: amount } },
            });

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: "CREDIT",
                    amount,
                    reason,
                    referenceId,
                    balanceAfter: updated.balance,
                },
            });

            return updated;
        }));
    },

    async debit(userId: string, amount: number, reason: string, referenceId?: string) {
        if (amount <= 0) throw new Error("Debit amount must be positive");

        const wallet = await db.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new Error("Wallet not found");

        return ignoreDuplicateEntry(wallet.id, () => db.$transaction(async (tx) => {
            const result = await tx.wallet.updateMany({
                where: { id: wallet.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } },
            });

            if (result.count === 0) {
                throw new Error("Insufficient credits");
            }

            const updated = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: "DEBIT",
                    amount,
                    reason,
                    referenceId,
                    balanceAfter: updated.balance,
                },
            });

            return updated;
        }));
    },

    async topup(
        userId: string,
        data: { amount: number; method: "NEFT" | "RTGS" | "UPI" | "IMPS"; utrReference: string }
    ) {
        if (data.amount <= 0) throw new Error("Top-up amount must be positive");

        const wallet = await this.getOrCreateWallet(userId);

        try {
            return await db.$transaction(async (tx) => {
                const topup = await tx.walletTopup.create({
                    data: {
                        userId,
                        walletId: wallet.id,
                        amount: data.amount,
                        method: data.method,
                        utrReference: data.utrReference,
                    },
                });

                const updatedWallet = await tx.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { increment: data.amount } },
                });

                await tx.walletTransaction.create({
                    data: {
                        walletId: wallet.id,
                        type: "CREDIT",
                        amount: data.amount,
                        reason: "TOPUP",
                        referenceId: topup.id,
                        balanceAfter: updatedWallet.balance,
                    },
                });

                return { topup, wallet: updatedWallet };
            });
        } catch (err: any) {
            if (err.code === "P2002") {
                throw new Error("This top-up has already been processed");
            }
            throw err;
        }
    },

    async getTransactions(userId: string, page = 1, limit = 20) {
        const cappedLimit = Math.min(limit, 100);
        const wallet = await this.getOrCreateWallet(userId);

        const [transactions, total] = await Promise.all([
            db.walletTransaction.findMany({
                where: { walletId: wallet.id },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * cappedLimit,
                take: cappedLimit,
            }),
            db.walletTransaction.count({ where: { walletId: wallet.id } }),
        ]);

        return { transactions, total, page, limit: cappedLimit, balance: Number(wallet.balance) };
    },

    async getTopupHistory(userId: string) {
        return db.walletTopup.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });
    },
};
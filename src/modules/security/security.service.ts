import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from "qrcode";
import { db } from '../../db';
import { decrypt, encrypt } from '../../utils/encryption';
import { redis, RedisKeys } from '../../db/redis';
import { getLocationFromIp } from '../../utils/geo';
import { EmailFactory } from '../../lib/notifications/email/email.factory';
import { logger } from '../../utils/logger';

const ACCESS_TOKEN_TTL_SECS = 15 * 60;
const EMAIL_CODE_TTL_SECS = 5 * 60;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const BACKUP_CODE_COUNT = 8;

export type TwoFactorMethod = "totp" | "email";

function generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
        const raw = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
        codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
    }
    return codes;
}

async function auditTwoFactorEvent(
    userId: string,
    action: string,
    metadata?: Record<string, any>,
) {
    await db.auditLog
        .create({
            data: {
                actorId: userId,
                actorType: "user",
                action,
                entityType: "user",
                entityId: userId,
                metadata,
            },
        })
        .catch((err: any) => logger.error({ err: err.message, action }, "Failed to write 2FA audit log"));
}

function isValidResult(result: any): boolean {
    // otplib's verify() returns true, or an object with a `valid` (or legacy `success`) property
    if (result === true) return true;
    if (result && typeof result === "object") {
        if ("valid" in result) return !!result.valid;
        if ("success" in result) return !!result.success;
    }
    return false;
}

function generateEmailCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendTwoFactorEmailCode(
    userId: string,
    email: string,
    name: string | null,
    purpose: string,
    purposeCopy: string,
): Promise<void> {
    const code = generateEmailCode();
    await redis.setex(RedisKeys.twoFactorEmailCode(purpose, userId), EMAIL_CODE_TTL_SECS, code);
    await redis.del(RedisKeys.twoFactorEmailAttempts(purpose, userId));

    await EmailFactory.get()
        .send({
            to: email,
            template: "two-factor-code",
            subject: "Your verification code",
            data: {
                name: name || "there",
                code,
                expiresInMinutes: EMAIL_CODE_TTL_SECS / 60,
                purpose: purposeCopy,
            },
        })
        .catch((err: any) => logger.error({ err: err.message }, "Failed to send 2FA email code"));
}

async function verifyEmailCode(userId: string, purpose: string, token: string): Promise<boolean> {
    const attemptsKey = RedisKeys.twoFactorEmailAttempts(purpose, userId);
    const attempts = await redis.incr(attemptsKey);
    if (attempts === 1) await redis.expire(attemptsKey, EMAIL_CODE_TTL_SECS);
    if (attempts > EMAIL_CODE_MAX_ATTEMPTS) throw new Error("Too many attempts, request a new code");

    const codeKey = RedisKeys.twoFactorEmailCode(purpose, userId);
    const stored = await redis.get(codeKey);
    if (!stored || stored !== token) return false;

    await redis.del(codeKey);
    await redis.del(attemptsKey);
    return true;
}

export const securityService = {
    async requestTwoFactorEmailCode(userId: string, purpose: "2fa-reverify" | "2fa-disable" | "2fa-login") {
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("User not found");

        const purposeCopy =
            purpose === "2fa-disable" ? "disable two-factor authentication"
            : purpose === "2fa-login" ? "sign in"
            : "confirm your identity";
        await sendTwoFactorEmailCode(userId, user.email, user.name, purpose, purposeCopy);
    },

    async generateTwoFactorSecret(userId: string, email: string, method: TwoFactorMethod, currentToken?: string) {
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("User not found");

        if (user.twoFactorEnabled) {
            if (!currentToken) {
                throw new Error("Current 2FA code required to re-enroll");
            }
            const valid = await this.verifyExistingTwoFactorToken(user, currentToken, "2fa-reverify");
            if (!valid) throw new Error("Invalid 2FA code");
        }

        if (method === "email") {
            await sendTwoFactorEmailCode(userId, email, user.name, "2fa-setup", "enable two-factor authentication");
            return { method: "email" as const };
        }

        const secret = generateSecret();
        const otpUrl = await generateURI({
            strategy: "totp",
            secret,
            label: email,
            issuer: "ETradeBazaar",
        });
        const qrCodeDataUrl = await QRCode.toDataURL(otpUrl);

        await db.user.update({
            where: { id: userId },
            data: { twoFactorSecret: encrypt(secret, userId) },
        });
        return { method: "totp" as const, qrCodeDataUrl, secret };
    },
    async verifyAndEnableTwoFactor(userId: string, method: TwoFactorMethod, token: string) {
        const backupCodes = generateBackupCodes();
        const hashedBackupCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

        if (method === "email") {
            const valid = await verifyEmailCode(userId, "2fa-setup", token);
            if (!valid) throw new Error("Invalid 2FA code");
            const updated = await db.user.update({
                where: { id: userId },
                data: {
                    twoFactorEnabled: true,
                    twoFactorMethod: "email",
                    twoFactorSecret: null,
                    twoFactorBackupCodes: hashedBackupCodes,
                },
            });
            await auditTwoFactorEvent(userId, "TWO_FACTOR_ENABLED", { method: "email" });
            return { ...updated, backupCodes };
        }

        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user?.twoFactorSecret) throw new Error("2FA setup not initiated");

        const secret = decrypt(user.twoFactorSecret, userId);
        const result = await verify({ token, secret });
        if (!isValidResult(result)) throw new Error("Invalid 2FA code");

        const updated = await db.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: true, twoFactorMethod: "totp", twoFactorBackupCodes: hashedBackupCodes },
        });
        await auditTwoFactorEvent(userId, "TWO_FACTOR_ENABLED", { method: "totp" });
        return { ...updated, backupCodes };
    },
    async verifyExistingTwoFactorToken(
        user: {
            id: string;
            twoFactorMethod: string | null;
            twoFactorSecret: string | null;
            twoFactorBackupCodes?: string[];
        },
        token: string,
        emailPurpose: string,
    ): Promise<boolean> {
        // A backup code always works regardless of the enrolled method, so a user
        // who lost their authenticator/email access still has a way in.
        if (user.twoFactorBackupCodes?.length) {
            for (const hashed of user.twoFactorBackupCodes) {
                if (await bcrypt.compare(token.toUpperCase(), hashed)) {
                    await db.user.update({
                        where: { id: user.id },
                        data: {
                            twoFactorBackupCodes: user.twoFactorBackupCodes.filter((c) => c !== hashed),
                        },
                    });
                    await auditTwoFactorEvent(user.id, "TWO_FACTOR_BACKUP_CODE_USED");
                    return true;
                }
            }
        }

        if (user.twoFactorMethod === "email") {
            return verifyEmailCode(user.id, emailPurpose, token);
        }
        if (!user.twoFactorSecret || !/^\d{6}$/.test(token)) return false;
        try {
            const secret = decrypt(user.twoFactorSecret, user.id);
            const result = await verify({ token, secret });
            return isValidResult(result);
        } catch (err: any) {
            logger.error({ err: err.message }, "TOTP verification threw");
            return false;
        }
    },
    async verifyTwoFactorToken(userId: string, token: string, emailPurpose = "2fa-login"): Promise<boolean> {
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user?.twoFactorEnabled) return false;
        return this.verifyExistingTwoFactorToken(user, token, emailPurpose);
    },
    async disableTwoFactor(userId: string, token: string) {
        const valid = await this.verifyTwoFactorToken(userId, token, "2fa-disable");
        if (!valid) throw new Error("Invalid 2FA code");

        const updated = await db.user.update({
            where: { id: userId },
            data: {
                twoFactorEnabled: false,
                twoFactorSecret: null,
                twoFactorMethod: null,
                twoFactorBackupCodes: [],
            },
        });
        await auditTwoFactorEvent(userId, "TWO_FACTOR_DISABLED");
        return updated;
    },
    async regenerateBackupCodes(userId: string, token: string) {
        const valid = await this.verifyTwoFactorToken(userId, token, "2fa-reverify");
        if (!valid) throw new Error("Invalid 2FA code");

        const backupCodes = generateBackupCodes();
        const hashedBackupCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));
        await db.user.update({
            where: { id: userId },
            data: { twoFactorBackupCodes: hashedBackupCodes },
        });
        await auditTwoFactorEvent(userId, "TWO_FACTOR_BACKUP_CODES_REGENERATED");
        return backupCodes;
    },
    async createSession(userId: string, deviceInfo: string, ipAddr: string, userAgent: string) {
        return db.session.create({
            data: { userId, deviceInfo, ipAddress: ipAddr, userAgent },
        });
    },
    async touchSession(
        sessionId: string
    ) {
        return db.session.update({
            where: { id: sessionId },
            data: { lastActiveAt: new Date() },
        }).catch(() => null);
    },
    async listSessions(userId: string) {
        const sessions = await db.session.findMany({
            where: { userId, revoked: false },
            orderBy: { lastActiveAt: "desc" },
        });

        return sessions.map((session) => ({
            ...session,
            location: getLocationFromIp(session.ipAddress ?? undefined),
        }));
    },
    async revokeSession(userId: string, sessionId: string) {
        const session = await db.session.findFirst({ where: { id: sessionId, userId } });
        if (!session) throw new Error("Session not found");

        const updated = await db.session.update({ where: { id: sessionId }, data: { revoked: true } });

        await redis.setex(RedisKeys.tokenBlacklist(sessionId), ACCESS_TOKEN_TTL_SECS, "1");

        return updated;
    },
    async revokeAllSessions(userId: string, exceptSessionId?: string) {
        const sessions = await db.session.findMany({
            where: { userId, revoked: false, id: exceptSessionId ? { not: exceptSessionId } : undefined },
            select: { id: true },
        });

        const result = await db.session.updateMany({
            where: { userId, id: exceptSessionId ? { not: exceptSessionId } : undefined },
            data: { revoked: true },
        });

        await Promise.all(
            sessions.map((s) => redis.setex(RedisKeys.tokenBlacklist(s.id), ACCESS_TOKEN_TTL_SECS, "1"))
        );

        return result;
    },
    async getSecuritySummary(userId: string) {
        const user = await db.user.findUnique({
            where: { id: userId },
            select: {
                twoFactorEnabled: true,
                twoFactorMethod: true,
                twoFactorBackupCodes: true,
                passwordChangedAt: true,
                lastLoginAt: true,
            },
        });
        if (!user) throw new Error("User not Found");

        const sessions = await db.session.findMany({
            where: { userId, revoked: false },
            orderBy: { lastActiveAt: "desc" },
            take: 1,
        });
        return {
            twoFactorEnabled: user.twoFactorEnabled,
            twoFactorMethod: user.twoFactorMethod,
            backupCodesRemaining: user.twoFactorBackupCodes.length,
            passwordLastChanged: user.passwordChangedAt,
            lastLogin: user.lastLoginAt,
            lastActiveDevice: sessions[0]?.deviceInfo ?? null,
            activeSessionCount: await db.session.count({ where: { userId, revoked: false } }),
        };
    },
};
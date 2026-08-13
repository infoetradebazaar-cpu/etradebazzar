import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from "qrcode";
import { db } from '../../db';
import { decrypt, encrypt } from '../../utils/encryption';
import { redis, RedisKeys } from '../../db/redis';
import { getLocationFromIp } from '../../utils/geo';

const ACCESS_TOKEN_TTL_SECS = 15 * 60;
function isValidResult(result: any): boolean {
    // v13 verify() returns true or an object with a success property
    if (result === true) return true;
    if (result && typeof result === "object" && "success" in result) return !!result.success;
    return false;
}

export const securityService = {
    async generateTwoFactorSecret(userId: string, email: string, currentToken?: string) {
        const user = await db.user.findUnique({ where: { id: userId } });

        if (user?.twoFactorEnabled) {
            if (!currentToken) {
                throw new Error("Current 2FA code required to re-enroll");
            }
            const valid = await this.verifyTwoFactorToken(userId, currentToken);
            if (!valid) throw new Error("Invalid 2FA code");
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
        return { qrCodeDataUrl, secret };
    },
    async verifyAndEnableTwoFactor(userId: string, token: string) {
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user?.twoFactorSecret) throw new Error("2FA setup not initiated");

        const secret = decrypt(user.twoFactorSecret, userId);
        const result = await verify({ token, secret });
        if (!isValidResult(result)) throw new Error("Invalid 2FA code");

        return db.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: true },
        });
    },
    async verifyTwoFactorToken(userId: string, token: string): Promise<boolean> {
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user?.twoFactorEnabled || !user.twoFactorSecret) return false;

        const secret = decrypt(user.twoFactorSecret, userId);
        const result = await verify({ token, secret });
        return isValidResult(result);
    },
    async disableTwoFactor(userId: string, token: string) {
        const valid = await this.verifyTwoFactorToken(userId, token);
        if (!valid) throw new Error("Invalid 2FA code");

        return db.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: false, twoFactorSecret: null },
        });
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
            select: { twoFactorEnabled: true, passwordChangedAt: true, lastLoginAt: true },
        });
        if (!user) throw new Error("User not Found");

        const sessions = await db.session.findMany({
            where: { userId, revoked: false },
            orderBy: { lastActiveAt: "desc" },
            take: 1,
        });
        return {
            twoFactorEnabled: user.twoFactorEnabled,
            passwordLastChanged: user.passwordChangedAt,
            lastLogin: user.lastLoginAt,
            lastActiveDevice: sessions[0]?.deviceInfo ?? null,
            activeSessionCount: await db.session.count({ where: { userId, revoked: false } }),
        };
    },
};
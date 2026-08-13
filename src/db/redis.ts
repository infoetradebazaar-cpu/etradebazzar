import Redis from "ioredis";
import { logger } from "../utils/logger";
import { config } from "../../config/config";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 500, 5000);
    if (times % 10 === 0) {
      logger.warn({ attempts: times }, "Redis still reconnecting");
    }
    return delay;
  },
  enableReadyCheck: true,
  commandTimeout: 5000,
  reconnectOnError: (err) => {
    const targetErrors = ["READONLY", "ECONNRESET"];
    return targetErrors.some((e) => err.message.includes(e));
  },
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("ready", () => logger.info("Redis ready"));
redis.on("error", (err) => logger.error({ err: err.message }, "Redis error"));
redis.on("close", () => logger.warn("Redis connection closed"));

export function isRedisReady(): boolean {
  return redis.status === "ready";
}

export const RedisKeys = {
  tokenBlacklist: (jti: string) => `blacklist:${jti}`,
  tokenFamilyBlacklist: (fam: string) => `blacklist:fam:${fam}`,
  authContext: (userId: string) => `authctx:${userId}`,
  sellerStatus: (sellerId: string) => `seller:status:${sellerId}`,
  userRoles: (userId: string, sellerId: string) => `rbac:${userId}:${sellerId}`,
  userPermissions: (userId: string, sellerId: string) => `perms:${userId}:${sellerId}`,
  platformPermissions: (userId: string) => `platform-perms:${userId}`,
  couponLock: (couponId: string) => `coupon:lock:${couponId}`,
  lowStockAlert: (productId: string, skuId?: string) =>
    skuId ? `lowstock:sku:${skuId}` : `lowstock:product:${productId}`,
  rateLimit: (prefix: string, identifier: string) => `rl:${prefix}:${identifier}`,
  pincodeLookup: (pincode: string) => `pincode:${pincode}`,
  otpCode: (purpose: string, phone: string) => `otp:code:${purpose}:${phone}`,
  otpAttempts: (purpose: string, phone: string) => `otp:attempts:${purpose}:${phone}`,
  searchAttributeLexicon: () => `search:attr-lexicon`,
} as const;
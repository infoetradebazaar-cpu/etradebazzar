import { Request, Response, NextFunction } from "express";
import { redis, RedisKeys } from "../db/redis";
import { logger } from "../utils/logger";

const FIXED_WINDOW_SCRIPT = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, window)
end

local ttl = redis.call('TTL', key)
return {count, ttl}
`;

interface RateLimitOptions {
    windowSecs: number;
    max: number;
    keyPrefix: string;
    keyExtractor?: (req: Request) => string | null;
    failClosed?: boolean;
}

interface RateLimitConfig {
    windowSecs: number;
    max: number;
}

function getConfig(key: string, defaults: RateLimitConfig): RateLimitConfig {
    const windowSecs = Number(process.env[`RATE_LIMIT_${key}_WINDOW`] ?? defaults.windowSecs);
    const max = Number(process.env[`RATE_LIMIT_${key}_MAX`] ?? defaults.max);

    if (!Number.isFinite(windowSecs) || windowSecs <= 0) {
        throw new Error(`Invalid RATE_LIMIT_${key}_WINDOW - refusing to boot with disabled rate limiting`);
    }
    if (!Number.isFinite(max) || max <= 0) {
        throw new Error(`Invalid RATE_LIMIT_${key}_MAX - refusing to boot with disabled rate limiting`);
    }

    return { windowSecs, max };
}

const TRUST_PROXY = process.env.TRUST_PROXY === "true";

function getIp(req: Request): string {
    if (TRUST_PROXY) {
        const forwarded = req.headers["x-forwarded-for"];
        if (forwarded) {
            const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
            if (first?.trim()) return first.trim();
        }
    }
    return req.ip ?? "unknown";
}

function getSellerOrIp(req: Request): string {
    return req.seller?.id ?? req.user?.id ?? getIp(req);
}

function createRateLimiter(opts: RateLimitOptions) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const identifier = opts.keyExtractor?.(req) ?? getIp(req);
            const key = RedisKeys.rateLimit(opts.keyPrefix, identifier);

            const result = await redis.eval(
                FIXED_WINDOW_SCRIPT,
                1,
                key,
                String(opts.windowSecs),
                String(opts.max),
            ) as [number, number];

            const count = result[0]!;
            const ttl = result[1]!;

            res.setHeader("X-RateLimit-Limit", opts.max);
            res.setHeader("X-RateLimit-Remaining", Math.max(0, opts.max - count));
            res.setHeader("X-RateLimit-Reset", Math.ceil(Date.now() / 1000) + ttl);

            if (count > opts.max) {
                res.setHeader("Retry-After", ttl);
                logger.warn({ key, count, limit: opts.max }, "Rate limit exceeded");
                return res.status(429).json({
                    success: false,
                    error: "Too many requests - please try again later",
                    retryAfter: ttl,
                });
            }

            next();
        } catch (err: any) {
            // Redis down - fail open, never block legitimate traffic
            logger.error(
                { err: err.message, keyPrefix: opts.keyPrefix },
                `Rate limiter Redis error - failing ${opts.failClosed ? "closed" : "open"}`
            );
            if (opts.failClosed) {
                return res.status(503).json({
                    success: false,
                    error: "Service temporarily unavailable, please try again shortly",
                });
            }
            next();
        }
    };
}

function getAuthIdentifier(req: Request): string {
    const rawAccountId = req.body?.email || req.body?.phone;
    const ip = getIp(req);
    if (!rawAccountId) return ip;
    const normalized = String(rawAccountId).trim().toLowerCase().slice(0, 320);
    return `${ip}:${normalized}`;
}

export const authLimiter = createRateLimiter({
    ...getConfig("AUTH", { windowSecs: 60, max: 10 }),
    keyPrefix: "auth",
    keyExtractor: getAuthIdentifier,
    failClosed: true,
});

export const sellerLimiter = createRateLimiter({
    ...getConfig("SELLER", { windowSecs: 60, max: 300 }),
    keyPrefix: "seller",
    keyExtractor: getSellerOrIp,
});

export const uploadLimiter = createRateLimiter({
    ...getConfig("UPLOAD", { windowSecs: 60, max: 20 }),
    keyPrefix: "upload",
    keyExtractor: getSellerOrIp,
});

export const publicLimiter = createRateLimiter({
    ...getConfig("PUBLIC", { windowSecs: 60, max: 100 }),
    keyPrefix: "public",
    keyExtractor: getIp,
});

export const paymentLimiter = createRateLimiter({
    ...getConfig("PAYMENT", { windowSecs: 60, max: 30 }),
    keyPrefix: "payment",
    keyExtractor: getIp,
    failClosed: true,
});

export const otpLimiter = createRateLimiter({
    ...getConfig("OTP", { windowSecs: 300, max: 5 }),
    keyPrefix: "otp",
    keyExtractor: getAuthIdentifier,
    failClosed: true,
});

export const verificationCostLimiter = createRateLimiter({
    ...getConfig("VERIFICATION_COST", { windowSecs: 60, max: 5 }),
    keyPrefix: "verification-cost",
    keyExtractor: getSellerOrIp,
    failClosed: true,
});

export const searchLimiter = createRateLimiter({
    ...getConfig("SEARCH", { windowSecs: 60, max: 60 }),
    keyPrefix: "search",
    keyExtractor: getIp,
});

export const twoFactorLimiter = createRateLimiter({
    ...getConfig("2FA", { windowSecs: 60, max: 5 }),
    keyPrefix: "2fa",
    keyExtractor: (req) => req.user?.id ?? getIp(req),
    failClosed: true,
});
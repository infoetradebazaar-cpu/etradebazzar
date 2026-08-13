import jwt, { SignOptions, VerifyOptions, Algorithm } from "jsonwebtoken";
import crypto from "crypto";

import { config } from "../../config/config";
import { redis, RedisKeys } from "../db/redis";
import { logger } from "../utils/logger";

const PRIVATE_KEY = config.jwtPrivateKey;
const PUBLIC_KEY = config.jwtPublicKey;
const FALLBACK_SECRET = config.jwtSecret;

if ((PRIVATE_KEY && !PUBLIC_KEY) || (!PRIVATE_KEY && PUBLIC_KEY)) {
  throw new Error("Only one of jwtPrivateKey/jwtPublicKey is set refusing to boot with a broken RS256 config");
}
if (!PRIVATE_KEY && !PUBLIC_KEY) {
  logger.warn("No RS256 keys configured falling back to HS256 symmetric signing");
}

const ALGORITHM: Algorithm = PRIVATE_KEY && PUBLIC_KEY ? "RS256" : "HS256";

interface SignInput {
  sub: string;
  email?: string;
  role?: string;
}

interface JwtPayload extends SignInput {
  type?: "access" | "refresh" | "sse";
  jti?: string;
  fam?: string;
  exp?: number;
  [key: string]: any;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

class JwtService {
  private sign(payload: SignInput,type: "access" | "refresh" | "sse",expiresIn: string, jti: string, fam?: string): string {
    const options: SignOptions = {
      algorithm: ALGORITHM,
      expiresIn: expiresIn as SignOptions["expiresIn"],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    };

    const key = ALGORITHM === "RS256" ? PRIVATE_KEY : FALLBACK_SECRET;

    return jwt.sign({ ...payload, type, jti, ...(fam ? { fam } : {}) }, key!, options);
  }

  private verify<T extends object = JwtPayload>(token: string): T & { jti?: string } {
    const options: VerifyOptions = {
      algorithms: [ALGORITHM],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    };

    const key = ALGORITHM === "RS256" ? PUBLIC_KEY : FALLBACK_SECRET;

    try {
      return jwt.verify(token, key!, options) as T & { jti?: string };
    } catch (err: any) {
      if (err.name === "TokenExpiredError") throw new Error("Token expired");
      if (err.name === "JsonWebTokenError") throw new Error("Invalid token");
      throw new Error("Token verification failed");
    }
  }

  signTokens(payload: SignInput, opts?: { sessionId?: string; family?: string }): Tokens {
    const sessionId = opts?.sessionId ?? crypto.randomUUID();
    const family = opts?.family ?? crypto.randomUUID();

    return {
      accessToken: this.sign(payload, "access", config.accessTokenExpiresIn, sessionId),
      refreshToken: this.sign(payload, "refresh", config.refreshTokenExpiresIn, crypto.randomUUID(), family),
      sessionId,
    };
  }

  signSseToken(userId: string): string {
    return this.sign({ sub: userId }, "sse", "3m", crypto.randomUUID());
  }

  async refreshToken(oldRefreshToken: string): Promise<Tokens> {
    const payload = this.verify<JwtPayload>(oldRefreshToken);

    if (payload.type !== "refresh") {
      throw new Error("Invalid token type");
    }
    if (!payload.jti || !payload.fam) {
      throw new Error("Invalid refresh token missing jti/fam");
    }

    const familyBurned = await redis.get(RedisKeys.tokenFamilyBlacklist(payload.fam));
    if (familyBurned) {
      throw new Error("Refresh token reuse detected");
    }

    const ttlSeconds = this.getRemainingTtl(payload);

    const claimed = ttlSeconds > 0
      ? await redis.set(RedisKeys.tokenBlacklist(payload.jti), "1", "EX", ttlSeconds, "NX")
      : "OK"; 

    if (claimed === null) {
      await redis.setex(RedisKeys.tokenFamilyBlacklist(payload.fam), ttlSeconds > 0 ? ttlSeconds : 60, "1");
      logger.error({ sub: payload.sub, fam: payload.fam }, "SECURITY: refresh token reuse family revoked");
      throw new Error("Refresh token reuse detected");
    }

    return this.signTokens(
      { sub: payload.sub, email: payload.email, role: payload.role },
      { family: payload.fam }
    );
  }

  verifyToken<T extends object = JwtPayload>(token: string, expectedType?: "access" | "refresh" | "sse") {
    const payload = this.verify<T & { type?: string }>(token);
    if (expectedType && payload.type !== expectedType) {
      throw new Error("Invalid token type");
    }
    return payload;
  }

  async revokeRefreshFamily(refreshToken: string): Promise<void> {
    try {
      const payload = this.verify<JwtPayload>(refreshToken);
      if (!payload.fam) return;
      const ttl = this.getRemainingTtl(payload);
      await redis.setex(RedisKeys.tokenFamilyBlacklist(payload.fam), ttl > 0 ? ttl : 60, "1");
    } catch {
    }
  }

  private getRemainingTtl(payload: { exp?: number }): number {
    if (!payload.exp) return 0;
    return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
  }
}

export const jwtService = new JwtService();

export const signTokens = jwtService.signTokens.bind(jwtService);
export const refreshToken = jwtService.refreshToken.bind(jwtService);
export const verifyToken = jwtService.verifyToken.bind(jwtService);
export const signSseToken = jwtService.signSseToken.bind(jwtService);
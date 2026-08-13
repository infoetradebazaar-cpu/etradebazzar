import { Request, Response, NextFunction } from "express";
import { jwtService } from "../utils/jwt";

import { logger } from "../utils/logger";

import { db } from "../db/index";
import { redis, RedisKeys } from "../db/redis";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        sellerId?: string;
        [key: string]: any;
      };
      sessionId?: string;
    }
  }
}

const ROLE_CACHE_TTL = 300;

async function resolveUserFromToken(
  token: string,
  expectedType: "access" | "sse" = "access",
): Promise<{ user: NonNullable<Request["user"]>; sessionId: string }> {
  const payload = jwtService.verifyToken(token, expectedType);

  if (!payload.sub) throw new Error("Token missing user ID");
  if (!payload.jti) throw new Error("Token missing session ID");

  const blacklisted = await redis.get(RedisKeys.tokenBlacklist(payload.jti));
  if (blacklisted) {
    const err: any = new Error("Token revoked");
    err.code = "TOKEN_REVOKED";
    throw err;
  }

  const roleCacheKey = RedisKeys.authContext(payload.sub);
  const cachedCtx = await redis.get(roleCacheKey);

  let userCtx: {
    id: string;
    email: string | null;
    name: string | null;
    isActive: boolean;
    sellerId?: string;
    role: string;
  };

  if (cachedCtx) {
    userCtx = JSON.parse(cachedCtx);
    if (!userCtx.isActive) throw new Error("User account disabled");
  } else {
    const user = await db.user.findUnique({ where: { id: payload.sub } });

    if (!user) throw new Error("User no longer exists");
    if (!user.isActive) throw new Error("User account disabled");

    const [member, platformMember] = await Promise.all([
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
        return tx.sellerMember.findFirst({
          where: { userId: user.id, isActive: true },
          select: { sellerId: true },
        });
      }),

      db.platformMember.findFirst({
        where: { userId: user.id },
        include: { role: true },
      }),
    ]);

    // Determine role: platform role takes precedence, then seller, then user
    let role = "user";
    if (platformMember?.role?.name) {
      role = platformMember.role.name;
    } else if (member?.sellerId) {
      role = "seller";
    }

    userCtx = {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      sellerId: member?.sellerId,
      role,
    };

    await redis.setex(roleCacheKey, ROLE_CACHE_TTL, JSON.stringify(userCtx));
  }

  return {
    user: {
      id: userCtx.id,
      email: userCtx.email ?? undefined,
      name: userCtx.name ?? undefined,
      sellerId: userCtx.sellerId,
      role: userCtx.role,
    },
    sessionId: payload.jti,
  };
}

function handleAuthError(req: Request, res: Response, error: any) {
  logger.warn({ ip: req.ip, userAgent: req.get("User-Agent") }, "Auth failed: " + error.message);
  if (error.code === "TOKEN_REVOKED") {
    return res.status(401).json({ error: "Token revoked", code: "TOKEN_REVOKED" });
  }
  if (error.message === "Token expired") {
    return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
  }
  return res.status(401).json({ error: "Invalid token", code: "TOKEN_INVALID" });
}

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;

  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = auth.split(" ")[1];

  try {
    const { user, sessionId } = await resolveUserFromToken(token as string);
    req.user = user;
    req.sessionId = sessionId;
    next();
  } catch (error: any) {
    return handleAuthError(req, res, error);
  }
};

export const protectSse = async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  const headerToken = auth?.startsWith("Bearer ") ? auth.split(" ")[1] : undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

  if (!headerToken && !queryToken) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const { user, sessionId } = headerToken
      ? await resolveUserFromToken(headerToken, "access")
      : await resolveUserFromToken(queryToken!, "sse");
    req.user = user;
    req.sessionId = sessionId;
    next();
  } catch (error: any) {
    return handleAuthError(req, res, error);
  }
};
export async function invalidateAuthContext(userId: string) {
  await redis.del(RedisKeys.authContext(userId));
}

export const restrictTo = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!allowedRoles.includes(req.user.role || "user")) {
      return res.status(403).json({ error: "Forbidden. Insufficient role." });
    }

    next();
  };
};

export const refreshAccessToken = async (req: Request, res: Response) => {
  const oldRefreshToken = req.cookies?.refreshToken || req.body.refreshToken;

  if (!oldRefreshToken) {
    return res.status(401).json({ error: "No refresh token provided" });
  }

  try {
    const { accessToken, refreshToken: newRefreshToken } =
      await jwtService.refreshToken(oldRefreshToken);

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ accessToken });
  } catch (error: any) {
    if (error.message === "Refresh token reuse detected") {
      logger.error(
        { ip: req.ip, userAgent: req.get("User-Agent") },
        "SECURITY: refresh token reuse detected possible token theft"
      );
      return res.status(401).json({ error: "Session invalidated, please log in again" });
    }

    logger.warn(
      { ip: req.ip, userAgent: req.get("User-Agent") },
      "Refresh token failed: " + error.message
    );

    return res.status(401).json({ error: "Invalid refresh token" });
  }
};

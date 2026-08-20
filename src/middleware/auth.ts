import { Request, Response, NextFunction } from "express";
import { jwtService } from "../utils/jwt";

import { logger } from "../utils/logger";

import { db } from "../db/index";
import { redis, RedisKeys } from "../db/redis";
import {
  getCustomerOrgMemberships,
  type CustomerOrgMembershipContext,
} from "../lib/permission/customer-org-permission.service";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        sellerId?: string;
        customerOrgMemberships?: CustomerOrgMembershipContext[];
        [key: string]: any;
      };
      customerOrg?: CustomerOrgMembershipContext;
      sessionId?: string;
    }
  }
}

const ROLE_CACHE_TTL = 300;
export const ACTIVE_ORG_HEADER = "x-active-org-id";

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
    passwordChangedAt: string | null;
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
      passwordChangedAt: user.passwordChangedAt ? user.passwordChangedAt.toISOString() : null,
    };

    await redis.setex(roleCacheKey, ROLE_CACHE_TTL, JSON.stringify(userCtx));
  }

  if (userCtx.passwordChangedAt && payload.iat) {
    const passwordChangedAtSecs = Math.floor(new Date(userCtx.passwordChangedAt).getTime() / 1000);
    if (payload.iat < passwordChangedAtSecs) {
      const err: any = new Error("Token revoked due to password change");
      err.code = "TOKEN_REVOKED";
      throw err;
    }
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

async function attachCustomerOrgContext(
  req: Request,
  res: Response,
  user: NonNullable<Request["user"]>,
): Promise<boolean> {
  const memberships = await getCustomerOrgMemberships(user.id);
  user.customerOrgMemberships = memberships;

  if (memberships.length === 0) return true;

  const rawHeader = req.headers[ACTIVE_ORG_HEADER];
  const requestedOrgId = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader)?.trim();

  if (!requestedOrgId) {
    req.customerOrg = memberships[0];
    return true;
  }

  const match = memberships.find((m) => m.orgId === requestedOrgId);
  if (!match) {
    logger.warn(
      { userId: user.id, requestedOrgId, path: req.originalUrl },
      "Rejected X-Active-Org-Id for an org the user is not an active member of",
    );
    res.status(403).json({
      error: "Not an active member of the requested organization",
      code: "INVALID_ACTIVE_ORG",
    });
    return false;
  }

  req.customerOrg = match;
  return true;
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
    if (!(await attachCustomerOrgContext(req, res, user))) return;
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
    if (!(await attachCustomerOrgContext(req, res, user))) return;
    next();
  } catch (error: any) {
    return handleAuthError(req, res, error);
  }
};
export async function invalidateAuthContext(userId: string) {
  await redis.del(RedisKeys.authContext(userId));
}

export async function invalidateCustomerOrgContext(userId: string) {
  await redis.del(RedisKeys.customerOrgMemberships(userId));
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

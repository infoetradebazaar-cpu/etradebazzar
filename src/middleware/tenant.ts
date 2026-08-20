import  { Request, Response, NextFunction } from "express";
import { db } from "../db/index";
import { redis, RedisKeys } from "../db/redis";
import { logger } from "../utils/logger";
import { runWithTenantContext, getTenantContext } from "./tenant-context";

declare global {
  namespace Express {
    interface Request {
      seller?: {
        id: string;
        status: string;
        name: string;
      };
    }
  }
}

export async function invalidateSellerStatusCache(sellerId: string) {
  await redis.del(RedisKeys.sellerStatus(sellerId));
}

export async function platformRoleCheckPasses(userId: string, roles: string[]): Promise<boolean> {
  const cacheKey = RedisKeys.userRoles(userId, "platform");
  const cached = await redis.get(cacheKey);

  let platformRole: string | null = null;
  if (cached) {
    platformRole = cached;
  } else {
    const member = await db.platformMember.findUnique({
      where: { userId },
      select: { role: { select: { name: true } } },
    });
    platformRole = member?.role.name ?? null;
    if (platformRole) {
      await redis.setex(cacheKey, 300, platformRole);
    }
  }

  return !!platformRole && roles.includes(platformRole);
}

export const resolveTenant = async (req: Request, res: Response, next: NextFunction) => {
  const sellerId = req.user?.sellerId;

  if (!sellerId) {
    return runWithTenantContext({}, next);
  }

  try {
    const cached = await redis.get(RedisKeys.sellerStatus(sellerId));

    if (cached) {
      req.seller = JSON.parse(cached);
    } else {
      const seller = await db.seller.findUnique({
        where: { id: sellerId },
        select: { id: true, status: true, name: true },
      });

      if (!seller) {
        return res.status(403).json({ error: "Seller not found" });
      }

      req.seller = seller;
      await redis.setex(RedisKeys.sellerStatus(sellerId), 300, JSON.stringify(seller));
    }

    if (req.seller?.status === "SUSPENDED") {
      return res.status(403).json({ error: "Seller account suspended" });
    }

    if (req.seller?.status !== "APPROVED") {
      return res.status(403).json({ error: "Seller account not approved" });
    }

    runWithTenantContext({ sellerId }, next);
  } catch (error: any) {
    logger.error({ err: error.message }, "Tenant resolution failed");
    return res.status(500).json({ error: "Internal server error" });
  }
};

/** @deprecated use requirePlatformAdmin(...roles) instead **/
export const requirePlatformAdmin = (...roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const cacheKey = RedisKeys.userRoles(req.user.id, "platform");
      const cached = await redis.get(cacheKey);

      let platformRole: string | null = null;
      if (cached) {
        platformRole = cached;
      } else {
        const member = await db.platformMember.findUnique({
          where: { userId: req.user.id },
          select: { role: { select: { name: true } } },
        });
        platformRole = member?.role.name ?? null;
        if (platformRole) {
          await redis.setex(cacheKey, 300, platformRole);
        }
      }

      if (!platformRole || !roles.includes(platformRole)) {
        logger.warn(
          { actorId: req.user.id, requiredRoles: roles, path: req.originalUrl },
          "Platform admin RBAC denied"
        );
        return res.status(403).json({ error: "Insufficient platform permissions" });
      }

      return runWithTenantContext({ isPlatformAdmin: true }, next);
    } catch (error: any) {
      logger.error({ err: error.message }, "Platform admin check failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  };
};

/** @deprecated use requirePlatformAdmin(...roles) instead **/
export const setPlatformAdmin = (req: Request, res: Response, next: NextFunction) => {
  logger.warn({ path: req.originalUrl }, "DEPRECATED setPlatformAdmin used - migrate to requirePlatformAdmin");
  runWithTenantContext({ isPlatformAdmin: true }, next);
};

export async function withTenantScope<T>(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  const ctx = getTenantContext();

  return db.$transaction(async (tx) => {
    if (ctx.isPlatformAdmin) {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
    } else if (ctx.sellerId) {
      await tx.$executeRaw`SELECT set_config('app.current_seller', ${ctx.sellerId}, true)`;
    } else {
      throw new Error("withTenantScope called with no tenant context - refusing to run unscoped query on RLS-protected table");
    }
    return fn(tx);
  });
}

export async function withSystemScope<T>(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_system_operation', 'true', true)`;
    return fn(tx);
  });
}

export async function withCustomerOrgScope<T>(
  orgId: string,
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  if (!orgId) {
    throw new Error("withCustomerOrgScope called without an org id - refusing to run unscoped query on RLS-protected table");
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_customer_org', ${orgId}, true)`;
    return fn(tx);
  });
}

export async function setCustomerOrgScope(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  orgId: string | null | undefined
): Promise<void> {
  if (!orgId) return;
  await tx.$executeRaw`SELECT set_config('app.current_customer_org', ${orgId}, true)`;
}

export async function withOptionalTenantScope<T>(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  const ctx = getTenantContext();
  return db.$transaction(async (tx) => {
    if (ctx.isPlatformAdmin) {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
    } else if (ctx.sellerId) {
      await tx.$executeRaw`SELECT set_config('app.current_seller', ${ctx.sellerId}, true)`;
    }
    return fn(tx);
  });
}
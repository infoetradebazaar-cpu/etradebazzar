import { Request, Response, NextFunction } from "express";
import { db } from "../db/index";
import { redis, RedisKeys } from "../db/redis";
import { logger } from "../utils/logger";
import { withTenantScope } from "./tenant";

export async function invalidateRoleCache(userId: string, scope: string) {
  await redis.del(RedisKeys.userRoles(userId, scope));
}

export const requirePlatformRole = (...roles: string[]) => {
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
          "Platform RBAC denied"
        );
        return res.status(403).json({ error: "Insufficient platform permissions" });
      }

      next();
    } catch (error: any) {
      logger.error({ err: error.message }, "RBAC check failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  };
};

export const requireSellerRole = (...roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.seller) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const cacheKey = RedisKeys.userRoles(req.user.id, req.seller.id);
      const cached = await redis.get(cacheKey);

      let sellerRole: string | null = null;

      if (cached) {
        sellerRole = cached;
      } else {
        const member = await withTenantScope((tx) =>
          tx.sellerMember.findUnique({
            where: { userId_sellerId: { userId: req.user!.id, sellerId: req.seller!.id } },
            select: { role: { select: { name: true } } },
          }),
        );
        sellerRole = member?.role.name ?? null;
        if (sellerRole) {
          await redis.setex(cacheKey, 300, sellerRole);
        }
      }

      if (!sellerRole || !roles.includes(sellerRole)) {
        logger.warn(
          { actorId: req.user.id, sellerId: req.seller.id, requiredRoles: roles, path: req.originalUrl },
          "Seller RBAC denied"
        );
        return res.status(403).json({ error: "Insufficient seller permissions" });
      }

      next();
    } catch (error: any) {
      logger.error({ err: error.message }, "RBAC check failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  };
};
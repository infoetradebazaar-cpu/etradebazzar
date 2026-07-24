import { Request, Response, NextFunction } from "express";
import { db } from "../db/index";
import { redis, RedisKeys } from "../db/redis";
import { logger } from "../utils/logger";
import { withTenantScope } from "./tenant";

export const requirePermission = (...keys: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user || !req.seller) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        try {
            const cacheKey = RedisKeys.userPermissions(req.user.id, req.seller.id);
            const cached = await redis.get(cacheKey);

            let permissions: string[];

            if (cached) {
                permissions = JSON.parse(cached);
            } else {
                const member = await withTenantScope((tx) =>
                    tx.sellerMember.findUnique({
                        where: { userId_sellerId: { userId: req.user!.id, sellerId: req.seller!.id } },
                        select: {
                            role: {
                                select: {
                                    permissions: { select: { permission: { select: { key: true } } } },
                                },
                            },
                        },
                    }),
                );
                permissions = member?.role.permissions.map((p) => p.permission.key) ?? [];
                await redis.setex(cacheKey, 300, JSON.stringify(permissions));
            }

            const ok = keys.every((k) => permissions.includes(k));
            if (!ok) {
                return res.status(403).json({ error: "Insufficient permissions" });
            }

            next();
        } catch (error: any) {
            logger.error({ err: error.message }, "Permission check failed");
            return res.status(500).json({ error: "Internal server error" });
        }
    };
};
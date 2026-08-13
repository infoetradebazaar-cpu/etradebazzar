import { Request, Response, NextFunction } from "express";
import { db } from "../db/index";
import { redis, RedisKeys } from "../db/redis";
import { logger } from "../utils/logger";
import { withTenantScope, platformRoleCheckPasses } from "./tenant";
import { runWithTenantContext } from "./tenant-context";
import { EmailFactory } from "../lib/notifications/email/email.factory";
import { config } from "../../config/config";

async function getSellerMemberPermissions(userId: string, sellerId: string): Promise<string[]> {
    const cacheKey = RedisKeys.userPermissions(userId, sellerId);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const member = await withTenantScope((tx) =>
        tx.sellerMember.findUnique({
            where: { userId_sellerId: { userId, sellerId } },
            select: {
                role: {
                    select: {
                        permissions: { select: { permission: { select: { key: true } } } },
                    },
                },
            },
        }),
    );
    const permissions = member?.role.permissions.map((p) => p.permission.key) ?? [];
    await redis.setex(cacheKey, 300, JSON.stringify(permissions));
    return permissions;
}

export const requirePermission = (...keys: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user || !req.seller) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        try {
            const permissions = await getSellerMemberPermissions(req.user.id, req.seller.id);
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

export const requirePermissionIfSeller = (...keys: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: "Not authenticated" });
        }
        if (!req.seller) return next();

        try {
            const permissions = await getSellerMemberPermissions(req.user.id, req.seller.id);
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

export async function invalidatePlatformPermissionCache(userId: string) {
    await redis.del(RedisKeys.platformPermissions(userId));
}

export async function getPlatformPermissions(userId: string): Promise<string[]> {
    const cacheKey = RedisKeys.platformPermissions(userId);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const member = await db.platformMember.findUnique({
        where: { userId },
        select: {
            role: {
                select: {
                    permissions: { select: { permission: { select: { key: true } } } },
                },
            },
        },
    });

    const permissions = member?.role.permissions.map((p) => p.permission.key) ?? [];
    await redis.setex(cacheKey, 300, JSON.stringify(permissions));
    return permissions;
}

export const requirePlatformPermission = (...keys: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        try {
            const permissions = await getPlatformPermissions(req.user.id);
            const ok = keys.every((k) => permissions.includes(k));
            if (!ok) {
                return res.status(403).json({ error: "Insufficient permissions" });
            }

            return runWithTenantContext({ isPlatformAdmin: true }, next);
        } catch (error: any) {
            logger.error({ err: error.message }, "Platform permission check failed");
            return res.status(500).json({ error: "Internal server error" });
        }
    };
};

async function sendRbacDisagreementAlert(context: {
    userId: string;
    path: string;
    method: string;
    requiredRoles: string[];
    requiredPermissionKeys: string[];
    legacyCheckPassed: boolean;
    permissionCheckPassed: boolean;
}) {
    await EmailFactory.get().send({
        to: config.securityAlertEmail,
        subject: "Platform RBAC dual-run check disagreement",
        template: "rbac-disagreement-alert",
        data: {
            userId: context.userId,
            path: context.path,
            method: context.method,
            requiredRoles: context.requiredRoles.join(", "),
            requiredPermissionKeys: context.requiredPermissionKeys.join(", "),
            legacyCheckPassed: context.legacyCheckPassed,
            permissionCheckPassed: context.permissionCheckPassed,
            occurredAt: new Date().toISOString(),
        },
    });
}

async function recordRbacDisagreement(context: {
    userId: string;
    path: string;
    method: string;
    requiredRoles: string[];
    requiredPermissionKeys: string[];
    legacyCheckPassed: boolean;
    permissionCheckPassed: boolean;
}) {
    try {
        await db.auditLog.create({
            data: {
                actorId: context.userId,
                actorType: "platform",
                action: "RBAC_DUAL_RUN_DISAGREEMENT",
                entityType: "platform_permission_check",
                entityId: context.path || "unknown",
                metadata: {
                    method: context.method,
                    requiredRoles: context.requiredRoles,
                    requiredPermissionKeys: context.requiredPermissionKeys,
                    legacyCheckPassed: context.legacyCheckPassed,
                    permissionCheckPassed: context.permissionCheckPassed,
                },
            },
        });
    } catch (err: any) {
        logger.error({ err: err.message }, "Failed to write RBAC disagreement to AuditLog");
    }
}

export const requirePlatformAdminAndPermission = (roles: string[], permissionKeys: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        try {
            const [legacyPassed, permissions] = await Promise.all([
                platformRoleCheckPasses(req.user.id, roles),
                getPlatformPermissions(req.user.id),
            ]);
            const permissionPassed = permissionKeys.every((k) => permissions.includes(k));

            if (legacyPassed !== permissionPassed) {
                const context = {
                    userId: req.user.id,
                    path: req.originalUrl,
                    method: req.method,
                    requiredRoles: roles,
                    requiredPermissionKeys: permissionKeys,
                    legacyCheckPassed: legacyPassed,
                    permissionCheckPassed: permissionPassed,
                };
                logger.error(context, "RBAC dual-run disagreement");
                await recordRbacDisagreement(context);
                sendRbacDisagreementAlert(context).catch((err: any) =>
                    logger.error({ err: err.message }, "Failed to send RBAC disagreement alert email"),
                );
            }

            if (!legacyPassed || !permissionPassed) {
                return res.status(403).json({ error: "Insufficient platform permissions" });
            }

            return runWithTenantContext({ isPlatformAdmin: true }, next);
        } catch (error: any) {
            logger.error({ err: error.message }, "Platform admin dual-run check failed");
            return res.status(500).json({ error: "Internal server error" });
        }
    };
};


import { db } from "../../db/index";
import { redis, RedisKeys } from "../../db/redis";
import { Prisma } from "../../../prisma/generated/client";
import {
    CUSTOMER_ORG_PERMISSION_KEYS,
    CUSTOMER_ORG_DEFAULT_ROLE_NAME,
} from "./customer-org-permission.constants";

const CUSTOMER_ORG_PERMISSION_CACHE_TTL = 300;

export interface CustomerOrgMembershipContext {
    memberId: string;
    orgId: string;
    orgName: string;
    orgCreatedBy: string;
    roleId: string;
    roleName: string;
}

export async function getCustomerOrgMemberships(
    userId: string,
): Promise<CustomerOrgMembershipContext[]> {
    const cacheKey = RedisKeys.customerOrgMemberships(userId);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const members = await db.customerOrgMember.findMany({
        where: { userId, isActive: true },
        select: {
            id: true,
            orgId: true,
            roleId: true,
            org: { select: { name: true, createdBy: true } },
            role: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
    });

    const memberships: CustomerOrgMembershipContext[] = members.map((m) => ({
        memberId: m.id,
        orgId: m.orgId,
        orgName: m.org.name,
        orgCreatedBy: m.org.createdBy,
        roleId: m.roleId,
        roleName: m.role.name,
    }));

    await redis.setex(cacheKey, CUSTOMER_ORG_PERMISSION_CACHE_TTL, JSON.stringify(memberships));
    return memberships;
}

/**
 * CustomerOrgMember -> CustomerOrgRole -> CustomerOrgRolePermission -> key[].
 */
export async function getCustomerOrgMemberPermissions(
    userId: string,
    orgId: string,
): Promise<string[]> {
    const cacheKey = RedisKeys.customerOrgPermissions(userId, orgId);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const member = await db.customerOrgMember.findUnique({
        where: { userId_orgId: { userId, orgId } },
        select: {
            isActive: true,
            role: {
                select: {
                    permissions: { select: { permission: { select: { key: true } } } },
                },
            },
        },
    });

    const permissions =
        member && member.isActive ? member.role.permissions.map((p) => p.permission.key) : [];
    await redis.setex(cacheKey, CUSTOMER_ORG_PERMISSION_CACHE_TTL, JSON.stringify(permissions));
    return permissions;
}

export async function hasCustomerOrgPermission(
    userId: string,
    orgId: string,
    ...keys: string[]
): Promise<boolean> {
    const permissions = await getCustomerOrgMemberPermissions(userId, orgId);
    return keys.every((k) => permissions.includes(k));
}

/**
 * Shared org-ownership check for org-scoped resources (Order, NegotiationSession).
 */
export async function canAccessOrgResource(
    userId: string | undefined,
    orgId: string | null | undefined,
    permissionKey: string,
): Promise<boolean> {
    if (!userId || !orgId) return false;
    return hasCustomerOrgPermission(userId, orgId, permissionKey);
}

export async function invalidateCustomerOrgPermissions(userId: string, orgId: string) {
    await redis.del(RedisKeys.customerOrgPermissions(userId, orgId));
}

export async function seedCustomerOrgPermissions(tx: Prisma.TransactionClient) {
    await tx.customerOrgPermission.createMany({
        data: CUSTOMER_ORG_PERMISSION_KEYS.map((key) => ({ key, description: key })),
        skipDuplicates: true,
    });
}

/**
 * Creates an org's default full-permissions role. Used when an org is created
 */
export async function createDefaultCustomerOrgRole(tx: Prisma.TransactionClient, orgId: string) {
    const permissions = await tx.customerOrgPermission.findMany({
        where: { key: { in: CUSTOMER_ORG_PERMISSION_KEYS as unknown as string[] } },
        select: { id: true, key: true },
    });

    if (permissions.length !== CUSTOMER_ORG_PERMISSION_KEYS.length) {
        throw new Error("Customer org permission catalog not seeded");
    }

    const role = await tx.customerOrgRole.create({
        data: { orgId, name: CUSTOMER_ORG_DEFAULT_ROLE_NAME },
    });

    await tx.customerOrgRolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
    });

    return role;
}

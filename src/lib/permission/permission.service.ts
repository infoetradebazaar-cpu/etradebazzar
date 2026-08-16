import { Prisma } from "../../../prisma/generated/client";
import { PERMISSIONS, PLATFORM_PERMISSIONS } from "./permission.constants";

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
    owner: Object.values(PERMISSIONS),
    manager: [
        PERMISSIONS.PRODUCTS_CREATE,
        PERMISSIONS.PRODUCTS_UPDATE,
        PERMISSIONS.PRODUCTS_VIEW,
        PERMISSIONS.PRODUCTS_BULK,
        PERMISSIONS.PRODUCTS_EXPORT,
        PERMISSIONS.PRODUCTS_IMAGES,
        PERMISSIONS.PRODUCTS_VARIANTS,
        PERMISSIONS.SELLER_MEMBERS_VIEW,
        PERMISSIONS.SELLER_MEMBERS_MANAGE,
        PERMISSIONS.SELLER_INVITES_MANAGE,
        PERMISSIONS.NEGOTIATIONS_RESPOND,
        PERMISSIONS.ANALYTICS_VIEW,
        PERMISSIONS.SELLER_PROFILE_MANAGE,
        PERMISSIONS.SELLER_VERIFICATION_VIEW,
        PERMISSIONS.RETURNS_VIEW,
        PERMISSIONS.RETURNS_MANAGE,
        PERMISSIONS.SHOPS_VIEW,
        PERMISSIONS.SHOPS_MANAGE,
        PERMISSIONS.CUSTOMIZATION_VIEW,
        PERMISSIONS.CUSTOMIZATION_MANAGE,
        PERMISSIONS.ORDERS_FULFILL,
        PERMISSIONS.ORDERS_MANAGE,
        PERMISSIONS.SHIPMENTS_VIEW,
        PERMISSIONS.SHIPMENTS_MANAGE,
        PERMISSIONS.REVIEWS_VIEW,
        PERMISSIONS.REVIEWS_MANAGE,
        PERMISSIONS.INVOICES_MANAGE,
    ],
    staff: [
        PERMISSIONS.PRODUCTS_VIEW,
        PERMISSIONS.SELLER_MEMBERS_VIEW,
        PERMISSIONS.RETURNS_VIEW,
        PERMISSIONS.SHOPS_VIEW,
        PERMISSIONS.CUSTOMIZATION_VIEW,
        PERMISSIONS.ORDERS_FULFILL,
        PERMISSIONS.SHIPMENTS_VIEW,
        PERMISSIONS.REVIEWS_VIEW,
    ],
    shop: [
        PERMISSIONS.ORDERS_FULFILL,
        PERMISSIONS.SHIPMENTS_VIEW,
        PERMISSIONS.SHIPMENTS_MANAGE,
        PERMISSIONS.RETURNS_VIEW,
    ],
};

export const DEFAULT_PLATFORM_ROLE_PERMISSIONS: Record<string, string[]> = {
    super_admin: Object.values(PLATFORM_PERMISSIONS),
    onboarding_manager: [
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_VIEW_LIST,
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_VIEW_DETAIL,
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_INVITE,
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_APPROVE,
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_REJECT,
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_KYC_REVIEW,
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_BANK_OVERRIDE,
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_GST_PAN_OVERRIDE,
        PLATFORM_PERMISSIONS.PLATFORM_VERIFICATION_REVIEW,
        PLATFORM_PERMISSIONS.PLATFORM_ANALYTICS_VIEW,
        PLATFORM_PERMISSIONS.PLATFORM_COUPONS_VIEW,
        PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_VIEW,
        PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW,
        PLATFORM_PERMISSIONS.PLATFORM_NOTIFICATIONS_VIEW,
        PLATFORM_PERMISSIONS.PLATFORM_RETURNS_VIEW,
        PLATFORM_PERMISSIONS.PLATFORM_AUDIT_LOGS_VIEW,
    ],
    product_reviewer: [
        PLATFORM_PERMISSIONS.PLATFORM_SELLERS_VIEW_DETAIL,
        PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_VIEW,
        PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_APPROVE,
        PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_REJECT,
        PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_SET_COMMISSION,
        PLATFORM_PERMISSIONS.PLATFORM_REVIEWS_MODERATE,
        PLATFORM_PERMISSIONS.PLATFORM_AUDIT_LOGS_VIEW,
    ],
};

export async function seedPlatformPermissions(tx: Prisma.TransactionClient) {
    const keys = [...Object.values(PERMISSIONS), ...Object.values(PLATFORM_PERMISSIONS)];
    await tx.permission.createMany({
        data: keys.map((key) => ({ key })),
        skipDuplicates: true,
    });
}

export async function assignDefaultRolePermissions(
    tx: Prisma.TransactionClient,
    roles: { id: string; name: string }[],
) {
    const allKeys = [...new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat())];

    const permissions = await tx.permission.findMany({
        where: { key: { in: allKeys } },
        select: { id: true, key: true },
    });

    if (permissions.length !== allKeys.length) {
        throw new Error("Permission catalog not seeded — run platform seed first");
    }

    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

    const rows = roles.flatMap((role) => {
        const keys = DEFAULT_ROLE_PERMISSIONS[role.name] ?? [];
        return keys.map((key) => ({
            roleId: role.id,
            permissionId: permissionIdByKey.get(key)!,
        }));
    });

    if (rows.length) {
        await tx.rolePermission.createMany({ data: rows, skipDuplicates: true });
    }
}
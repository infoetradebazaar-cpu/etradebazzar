export const CUSTOMER_ORG_PERMISSIONS = {
    VIEW_ORG_CART: "view_org_cart",
    EDIT_ORG_CART: "edit_org_cart",
    PLACE_ORDER: "place_order",
    VIEW_ORDER_HISTORY: "view_order_history",
    MANAGE_NEGOTIATIONS: "manage_negotiations",
    INVITE_MEMBERS: "invite_members",
    MANAGE_ROLES: "manage_roles",
    REMOVE_MEMBERS: "remove_members",
} as const;

export type CustomerOrgPermissionKey =
    (typeof CUSTOMER_ORG_PERMISSIONS)[keyof typeof CUSTOMER_ORG_PERMISSIONS];

export const CUSTOMER_ORG_PERMISSION_KEYS: CustomerOrgPermissionKey[] = Object.values(
    CUSTOMER_ORG_PERMISSIONS,
);

export const CUSTOMER_ORG_DEFAULT_ROLE_NAME = "admin";

export function isCustomerOrgPermissionKey(key: string): key is CustomerOrgPermissionKey {
    return (CUSTOMER_ORG_PERMISSION_KEYS as string[]).includes(key);
}

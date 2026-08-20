import { Router } from "express";
import { customerOrgController } from "./customer-org.controller";
import { protect } from "../../middleware/auth";
import { requireCustomerOrgPermission, requirePlatformAdminAndPermission } from "../../middleware/permission";
import { CUSTOMER_ORG_PERMISSIONS } from "../../lib/permission/customer-org-permission.constants";
import { PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { publicLimiter, sellerLimiter } from "../../middleware/rate-limit";
import {
    registerOrgAccountSchema,
    updateOrgBusinessDetailsSchema,
    createOrgSchema,
    updateOrgSchema,
    createOrgRoleSchema,
    updateOrgRoleSchema,
    orgRoleParamSchema,
    updateOrgRolePermissionsSchema,
    inviteOrgMemberSchema,
    orgInviteParamSchema,
    resendOrgInviteSchema,
    acceptOrgInviteSchema,
    orgMemberParamSchema,
    updateOrgMemberRoleSchema,
} from "./customer-org.schema";

const router = Router();

const requireOrgMember = requireCustomerOrgPermission();

router.post(
    "/invites/accept",
    publicLimiter,
    validate(acceptOrgInviteSchema),
    customerOrgController.acceptInvite,
);

router.post(
    "/register",
    publicLimiter,
    validate(registerOrgAccountSchema),
    customerOrgController.registerOrgAccount,
);

router.get(
    "/current/business",
    protect,
    sellerLimiter,
    requireOrgMember,
    customerOrgController.getBusinessDetails,
);

router.patch(
    "/current/business",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES),
    validate(updateOrgBusinessDetailsSchema),
    customerOrgController.updateBusinessDetails,
);

router.post("/", protect, sellerLimiter, validate(createOrgSchema), customerOrgController.createOrg);

router.get("/", protect, sellerLimiter, customerOrgController.listMyOrgs);

router.get("/permissions", protect, sellerLimiter, customerOrgController.listPermissionCatalog);

router.get("/current", protect, sellerLimiter, requireOrgMember, customerOrgController.getCurrentOrg);

router.patch(
    "/current",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES),
    validate(updateOrgSchema),
    customerOrgController.updateCurrentOrg,
);

router.get("/roles", protect, sellerLimiter, requireOrgMember, customerOrgController.listRoles);

router.post(
    "/roles",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES),
    validate(createOrgRoleSchema),
    customerOrgController.createRole,
);

router.patch(
    "/roles/:roleId",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES),
    validate(updateOrgRoleSchema),
    customerOrgController.updateRole,
);

router.delete(
    "/roles/:roleId",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES),
    validate(orgRoleParamSchema),
    customerOrgController.deleteRole,
);

router.get(
    "/roles/:roleId/permissions",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES),
    validate(orgRoleParamSchema),
    customerOrgController.listRolePermissions,
);

router.put(
    "/roles/:roleId/permissions",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES),
    validate(updateOrgRolePermissionsSchema),
    customerOrgController.updateRolePermissions,
);

// members
router.get("/members", protect, sellerLimiter, requireOrgMember, customerOrgController.listMembers);

router.patch(
    "/members/:memberId/role",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES),
    validate(updateOrgMemberRoleSchema),
    customerOrgController.updateMemberRole,
);

router.delete(
    "/members/:memberId",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.REMOVE_MEMBERS),
    validate(orgMemberParamSchema),
    customerOrgController.removeMember,
);

// invites
router.post(
    "/invites",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.INVITE_MEMBERS),
    validate(inviteOrgMemberSchema),
    customerOrgController.inviteMember,
);

router.get(
    "/invites",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.INVITE_MEMBERS),
    customerOrgController.listInvites,
);

router.post(
    "/invites/resend",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.INVITE_MEMBERS),
    validate(resendOrgInviteSchema),
    customerOrgController.resendInvite,
);

router.delete(
    "/invites/:inviteId",
    protect,
    sellerLimiter,
    requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.INVITE_MEMBERS),
    validate(orgInviteParamSchema),
    customerOrgController.revokeInvite,
);

// ── Admin endpoints ──────────────────────────────────────────────
router.get(
    "/admin/all",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_USERS_VIEW]),
    customerOrgController.adminListAllOrgs,
);

router.get(
    "/admin/:orgId",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_USERS_VIEW]),
    customerOrgController.adminGetOrgById,
);

export default router;

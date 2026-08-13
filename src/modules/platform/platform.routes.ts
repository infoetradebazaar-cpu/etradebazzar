import { Router } from "express";
import { platformController } from "./platform.controller";
import { protect } from "../../middleware/auth";
import { requirePlatformAdminAndPermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import {
  createPlatformRoleSchema,
  updatePlatformRoleSchema,
  platformRoleParamSchema,
  updatePlatformRolePermissionsSchema,
  createPlatformMemberSchema,
  updatePlatformMemberSchema,
  platformMemberParamSchema,
  getAuditLogsSchema,
} from "./platform.schema";

const router = Router();

// ROLES
router.get(
  "/roles",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE]),
  platformController.listRoles
);

router.post(
  "/roles",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE]),
  validate(createPlatformRoleSchema),
  platformController.createRole
);

router.patch(
  "/roles/:roleId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE]),
  validate(updatePlatformRoleSchema),
  platformController.updateRole
);

router.delete(
  "/roles/:roleId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE]),
  validate(platformRoleParamSchema),
  platformController.deleteRole
);

router.get(
  "/roles/:roleId/permissions",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE]),
  validate(platformRoleParamSchema),
  platformController.listRolePermissions
);

router.put(
  "/roles/:roleId/permissions",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE]),
  validate(updatePlatformRolePermissionsSchema),
  platformController.updateRolePermissions
);

router.get(
  "/permissions",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE]),
  platformController.listPlatformPermissions
);

// MEMBERS
router.get(
  "/members",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_MEMBERS_MANAGE]),
  platformController.listMembers
);

router.post(
  "/members",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_MEMBERS_MANAGE]),
  validate(createPlatformMemberSchema),
  platformController.addMember
);

router.patch(
  "/members/:memberId/role",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_MEMBERS_MANAGE]),
  validate(updatePlatformMemberSchema),
  platformController.updateMemberRole
);

router.delete(
  "/members/:memberId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_MEMBERS_MANAGE]),
  validate(platformMemberParamSchema),
  platformController.removeMember
);

// AUDIT LOGS
router.get(
  "/audit-logs",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_AUDIT_LOGS_VIEW]),
  validate(getAuditLogsSchema),
  platformController.getAuditLogs
);

export default router;
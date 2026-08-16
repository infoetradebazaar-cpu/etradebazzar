import { Router } from "express";
import { sellerController } from "./seller.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePermission, requirePlatformAdminAndPermission } from "../../middleware/permission";
import { PERMISSIONS, PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter, publicLimiter, verificationCostLimiter } from "../../middleware/rate-limit";
import {
  registerSellerSchema,
  completeSellerKycSchema,
  addBankDetailSchema,
  updateBankDetailSchema,
  bankReverifySchema,
  bankOverrideSchema,
  gstPanReverifySchema,
  gstPanOverrideSchema,
  inviteSellerSchema,
  acceptInviteSchema,
  approveSellerSchema,
  rejectSellerSchema,
  suspendSellerSchema,
  addMemberSchema,
  updateMemberRoleSchema,
  kycActionSchema,
  rejectKycSchema,
  verifyIfscSchema,
  inviteMemberSchema,
  removeMemberSchema,
  createRoleSchema,
  updateRoleSchema,
  roleParamSchema,
  inviteParamSchema,
  resendInviteSchema,
  acceptTeamInviteSchema,
} from "./seller.schema";

const router = Router();

//Public
router.post(
  "/register",
  publicLimiter,
  verificationCostLimiter,
  validate(registerSellerSchema),
  sellerController.register,
);
router.post(
  "/invite/accept",
  publicLimiter,
  validate(acceptInviteSchema),
  sellerController.acceptInvite,
);

//Platform admin
router.post(
  "/invite",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_INVITE]),
  validate(inviteSellerSchema),
  sellerController.inviteSeller,
);

router.get(
  "/pending",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_VIEW_LIST]),
  sellerController.listPendingSellers,
);

router.get(
  "/all",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_VIEW_LIST]),
  sellerController.listAllSellers,
);

router.get(
  "/kyc/pending",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_VIEW_LIST]),
  sellerController.listPendingKyc,
);

// Seller
router.post(
  "/kyc",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_KYC),
  validate(completeSellerKycSchema),
  sellerController.completeKyc,
);

router.post(
  "/bank",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_BANK),
  validate(addBankDetailSchema),
  sellerController.addBankDetail,
);

router.patch(
  "/bank",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_BANK),
  validate(updateBankDetailSchema),
  sellerController.updateBankDetail,
);

router.get(
  "/bank",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_BANK),
  sellerController.getBankDetail,
);

router.post(
  "/bank/verify-ifsc",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_BANK),
  validate(verifyIfscSchema),
  sellerController.verifyIfsc,
);

// Team management (must be before /:sellerId to avoid route shadowing)
router.get(
  "/members",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_MEMBERS_VIEW),
  sellerController.listMembers,
);

router.post(
  "/members",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_MEMBERS_MANAGE),
  validate(addMemberSchema),
  sellerController.addMember,
);

router.patch(
  "/members/:memberId/role",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_MEMBERS_MANAGE),
  validate(updateMemberRoleSchema),
  sellerController.updateMemberRole,
);

router.post(
  "/members/invite",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_MEMBERS_MANAGE),
  validate(inviteMemberSchema),
  sellerController.inviteMember,
);

router.delete(
  "/members/:memberId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_MEMBERS_MANAGE),
  validate(removeMemberSchema),
  sellerController.removeMember,
);

router.get(
  "/roles",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_MEMBERS_VIEW),
  sellerController.listRoles,
);

router.post(
  "/roles",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_ROLES_MANAGE),
  validate(createRoleSchema),
  sellerController.createRole,
);

router.patch(
  "/roles/:roleId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_ROLES_MANAGE),
  validate(updateRoleSchema),
  sellerController.updateRole,
);

router.delete(
  "/roles/:roleId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_ROLES_MANAGE),
  validate(roleParamSchema),
  sellerController.deleteRole,
);

router.get(
  "/roles/:roleId/permissions",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_ROLES_MANAGE),
  validate(roleParamSchema),
  sellerController.listRolePermissions,
);

router.put(
  "/roles/:roleId/permissions",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_ROLES_MANAGE),
  validate(roleParamSchema),
  sellerController.updateRolePermissions,
);

router.get(
  "/permissions",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_ROLES_MANAGE),
  sellerController.listAllPermissions,
);

router.get(
  "/invites",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_INVITES_MANAGE),
  sellerController.listInvites,
);

router.delete(
  "/invites/:inviteId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_INVITES_MANAGE),
  validate(inviteParamSchema),
  sellerController.revokeInvite,
);

router.post(
  "/invites/resend",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SELLER_INVITES_MANAGE),
  validate(resendInviteSchema),
  sellerController.resendInvite,
);

// Platform -Dynamic
router.get(
  "/:sellerId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_VIEW_DETAIL]),
  validate(approveSellerSchema),
  sellerController.getSellerById,
);

router.patch(
  "/:sellerId/approve",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_APPROVE]),
  validate(approveSellerSchema),
  sellerController.approveSeller,
);

router.patch(
  "/:sellerId/reject",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_REJECT]),
  validate(rejectSellerSchema),
  sellerController.rejectSeller,
);

router.patch(
  "/:sellerId/suspend",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_SUSPEND]),
  validate(suspendSellerSchema),
  sellerController.suspendSeller,
);

router.patch(
  "/:sellerId/reactivate",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_SUSPEND]),
  sellerController.reactivateSeller,
);

router.patch(
  "/:sellerId/kyc/verify",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_KYC_REVIEW]),
  validate(kycActionSchema),
  sellerController.verifyKyc,
);

router.patch(
  "/:sellerId/kyc/reject",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_KYC_REVIEW]),
  validate(rejectKycSchema),
  sellerController.rejectKyc,
);

router.patch(
  "/:sellerId/bank/reverify",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_BANK_OVERRIDE]),
  validate(bankReverifySchema),
  sellerController.reverifyBankDetail,
);

router.patch(
  "/:sellerId/bank/override",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_BANK_OVERRIDE]),
  validate(bankOverrideSchema),
  sellerController.overrideBankVerification,
);

router.patch(
  "/:sellerId/gst-pan/reverify",
  protect,
  sellerLimiter,
  verificationCostLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_GST_PAN_OVERRIDE]),
  validate(gstPanReverifySchema),
  sellerController.reverifyGstPan,
);

router.patch(
  "/:sellerId/gst-pan/override",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_SELLERS_GST_PAN_OVERRIDE]),
  validate(gstPanOverrideSchema),
  sellerController.overrideGstPanVerification,
);

// Public — no auth (invitee doesn't have account yet)
router.post(
  "/invites/accept",
  validate(acceptTeamInviteSchema),
  sellerController.acceptTeamInvite,
);
export default router;

import { Router } from "express";
import express from "express";
import { payoutController } from "./payout.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePlatformAdminAndPermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { paymentLimiter, sellerLimiter } from "../../middleware/rate-limit";
import {
  initiatePayoutSchema,
  payoutParamSchema,
  sellerPayoutParamSchema,
  setPlatformConfigSchema,
} from "./payout.schema";

const router = Router();


// Seller-facing: get own payout summary
router.get(
  "/me",
  protect,
  resolveTenant,
  sellerLimiter,
  payoutController.getMyPayoutSummary,
);

router.get(
  "/me/history",
  protect,
  resolveTenant,
  sellerLimiter,
  payoutController.getMyPayoutHistory,
);

// Seller-facing: get own payout by id
router.get(
  "/me/:payoutId",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(payoutParamSchema),
  payoutController.getMyPayoutById,
);

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  payoutController.webhook,
);
// Platform Config
router.post(
  "/config",
  protect,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_CONFIG]),
  sellerLimiter,
  validate(setPlatformConfigSchema),
  payoutController.setPlatformConfig,
);
//payout
router.get(
  "/sellers",
  protect,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_VIEW]),
  sellerLimiter,
  payoutController.listAllSellersSummary,
);

router.get(
  "/sellers/:sellerId",
  protect,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_VIEW]),
  sellerLimiter,
  validate(sellerPayoutParamSchema),
  payoutController.getSellerPayoutSummary,
);

router.post(
  "/sellers/:sellerId/initiate",
  protect,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_INITIATE]),
  paymentLimiter,
  validate(initiatePayoutSchema),
  payoutController.initiatePayout,
);

// History
router.get(
  "/history",
  protect,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_VIEW]),
  sellerLimiter,
  payoutController.getPayoutHistory,
);

router.get(
  "/history/:sellerId",
  protect,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_VIEW]),
  sellerLimiter,
  validate(sellerPayoutParamSchema),
  payoutController.getSellerPayoutHistory,
);

router.get(
  "/:payoutId",
  protect,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_VIEW]),
  sellerLimiter,
  validate(payoutParamSchema),
  payoutController.getPayoutById,
);

router.get(
  "/:payoutId/reconcile",
  protect,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_VIEW]),
  sellerLimiter,
  validate(payoutParamSchema),
  payoutController.reconcilePayout,
);

router.get(
  "/config",
  protect,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_CONFIG]),
  sellerLimiter,
  payoutController.getPayoutConfig,
);

router.get(
  "/sellers/:sellerId/export",
  protect,
  requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_PAYOUTS_VIEW]),
  sellerLimiter,
  payoutController.exportPayoutsCsv,
);

export default router;

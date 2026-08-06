import { Router } from "express";
import express from "express";
import { payoutController } from "./payout.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant, requirePlatformAdmin } from "../../middleware/tenant";
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
  requirePlatformAdmin("super_admin"),
  sellerLimiter,
  validate(setPlatformConfigSchema),
  payoutController.setPlatformConfig,
);
//payout
router.get(
  "/sellers",
  protect,
  requirePlatformAdmin("super_admin", "onboarding_manager"),
  sellerLimiter,
  payoutController.listAllSellersSummary,
);

router.get(
  "/sellers/:sellerId",
  protect,
  requirePlatformAdmin("super_admin", "onboarding_manager"),
  sellerLimiter,
  validate(sellerPayoutParamSchema),
  payoutController.getSellerPayoutSummary,
);

router.post(
  "/sellers/:sellerId/initiate",
  protect,
  requirePlatformAdmin("super_admin"),
  paymentLimiter,
  validate(initiatePayoutSchema),
  payoutController.initiatePayout,
);

// History
router.get(
  "/history",
  protect,
  requirePlatformAdmin("super_admin", "onboarding_manager"),
  sellerLimiter,
  payoutController.getPayoutHistory,
);

router.get(
  "/history/:sellerId",
  protect,
  requirePlatformAdmin("super_admin", "onboarding_manager"),
  sellerLimiter,
  validate(sellerPayoutParamSchema),
  payoutController.getSellerPayoutHistory,
);

router.get(
  "/:payoutId",
  protect,
  requirePlatformAdmin("super_admin", "onboarding_manager"),
  sellerLimiter,
  validate(payoutParamSchema),
  payoutController.getPayoutById,
);

router.get(
  "/config",
  protect,
  requirePlatformAdmin("super_admin"),
  sellerLimiter,
  payoutController.getPayoutConfig,
);

router.get(
  "/sellers/:sellerId/export",
  protect,
  requirePlatformAdmin("super_admin", "onboarding_manager"),
  sellerLimiter,
  payoutController.exportPayoutsCsv,
);

export default router;
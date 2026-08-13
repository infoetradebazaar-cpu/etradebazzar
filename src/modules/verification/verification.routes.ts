import { Router } from "express";
import { verificationController } from "./verification.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePlatformAdminAndPermission, requirePermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS, PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import {
    initializeDigilockerSchema, submitGovtIdSchema,
    rejectVerificationSchema, sellerParamSchema,
    verifyPanSchema, verifyAadhaarSchema,
} from "./verification.schema";

const router = Router();

// Seller
router.post("/aadhaar/digilocker/initialize", protect, sellerLimiter, resolveTenant, requirePermission(PERMISSIONS.SELLER_VERIFICATION_MANAGE),
    validate(initializeDigilockerSchema), verificationController.initializeAadhaarDigilocker);

router.post("/aadhaar/digilocker/confirm", protect, sellerLimiter, resolveTenant, requirePermission(PERMISSIONS.SELLER_VERIFICATION_MANAGE),
    verificationController.confirmAadhaarDigilocker);

router.post("/government-id", protect, sellerLimiter, resolveTenant, requirePermission(PERMISSIONS.SELLER_VERIFICATION_MANAGE),
    validate(submitGovtIdSchema), verificationController.submitGovernmentId);

router.post("/pan/verify", protect, sellerLimiter,
    validate(verifyPanSchema), verificationController.verifyPan);

router.post("/aadhaar/verify", protect, sellerLimiter,
    validate(verifyAadhaarSchema), verificationController.verifyAadhaarNumber);

router.get("/status", protect, sellerLimiter, resolveTenant, requirePermission(PERMISSIONS.SELLER_VERIFICATION_VIEW),
    verificationController.getStatus);

// Platform admin
router.patch("/:sellerId/aadhaar/verify", protect, sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_VERIFICATION_REVIEW]),
    validate(sellerParamSchema),
    verificationController.verifyAadhaar);

router.patch("/:sellerId/aadhaar/reject", protect, sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_VERIFICATION_REVIEW]),
    validate(rejectVerificationSchema),
    verificationController.rejectAadhaar);

router.patch("/:sellerId/government-id/verify", protect, sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_VERIFICATION_REVIEW]),
    validate(sellerParamSchema),
    verificationController.verifyGovernmentId);

router.patch("/:sellerId/government-id/reject", protect, sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_VERIFICATION_REVIEW]),
    validate(rejectVerificationSchema),
    verificationController.rejectGovernmentId);

export default router;
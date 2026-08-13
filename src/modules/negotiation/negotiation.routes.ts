import { Router } from "express";
import { negotiationController } from "./negotiation.controller";
import { manualNegotiationController } from "./manual-negotiation.controller";
import { adminNegotiationController } from "./admin-negotiation.controller";
import { myNegotiationController } from "./my-negotiation.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePlatformAdminAndPermission, requirePermissionIfSeller } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS, PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import {
  startAutoNegotiationSchema,
  negotiationSessionParamSchema,
  respondAutoNegotiationSchema,
  startManualNegotiationSchema,
  proposeTimeSlotSchema,
  confirmTimeSlotSchema,
  sendMessageSchema,
  manualAcceptSchema,
} from "./negotiation.schema";

const router = Router();

// Auto-negotiation (buyer<->system, bounded between visible tier price and the seller's hidden floor)
router.post(
  "/auto",
  protect,
  sellerLimiter,
  validate(startAutoNegotiationSchema),
  negotiationController.startAutoSession,
);
router.get(
  "/auto/:sessionId",
  protect,
  sellerLimiter,
  validate(negotiationSessionParamSchema),
  negotiationController.getSession,
);
router.patch(
  "/auto/:sessionId/respond",
  protect,
  sellerLimiter,
  validate(respondAutoNegotiationSchema),
  negotiationController.respond,
);

// Manual negotiation (buyer<->seller chat + scheduling) - both parties hit
// the same routes; resolveTenant (soft-fail, doesn't require a seller
// association) lets the controller tell which side is calling.
router.post(
  "/manual",
  protect,
  sellerLimiter,
  resolveTenant,
  validate(startManualNegotiationSchema),
  manualNegotiationController.startSession,
);
router.get(
  "/manual/:sessionId",
  protect,
  sellerLimiter,
  resolveTenant,
  validate(negotiationSessionParamSchema),
  manualNegotiationController.getSession,
);
router.post(
  "/manual/:sessionId/messages",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermissionIfSeller(PERMISSIONS.NEGOTIATIONS_RESPOND),
  validate(sendMessageSchema),
  manualNegotiationController.sendMessage,
);
router.post(
  "/manual/:sessionId/time-slot",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermissionIfSeller(PERMISSIONS.NEGOTIATIONS_RESPOND),
  validate(proposeTimeSlotSchema),
  manualNegotiationController.proposeTimeSlot,
);
router.patch(
  "/manual/:sessionId/time-slot/confirm",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermissionIfSeller(PERMISSIONS.NEGOTIATIONS_RESPOND),
  validate(confirmTimeSlotSchema),
  manualNegotiationController.confirmTimeSlot,
);
router.patch(
  "/manual/:sessionId/accept",
  protect,
  sellerLimiter,
  validate(manualAcceptSchema),
  manualNegotiationController.accept,
);
router.patch(
  "/manual/:sessionId/reject",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermissionIfSeller(PERMISSIONS.NEGOTIATIONS_RESPOND),
  validate(negotiationSessionParamSchema),
  manualNegotiationController.reject,
);

router.get("/mine", protect, sellerLimiter, resolveTenant, myNegotiationController.listSessions);

// Admin - read-only visibility into all negotiations (auto and manual).
router.get(
  "/admin",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_NEGOTIATIONS_VIEW]),
  adminNegotiationController.listSessions,
);
router.get(
  "/admin/:sessionId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_NEGOTIATIONS_VIEW]),
  validate(negotiationSessionParamSchema),
  adminNegotiationController.getSession,
);

export default router;

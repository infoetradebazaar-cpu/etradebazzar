import { Router } from "express";
import { adminNotificationController } from "./admin-notification.controller";
import { protect } from "../../middleware/auth";
import { requirePlatformPermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { sellerLimiter } from "../../middleware/rate-limit";
import { validate } from "../../utils/validate";
import { notificationTypeParamSchema, upsertTemplateSchema } from "./admin-notification.schema";

const router = Router();

router.get(
  "/events",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_NOTIFICATIONS_VIEW),
  sellerLimiter,
  adminNotificationController.listEventCatalog,
);

router.get(
  "/templates/:type",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_NOTIFICATIONS_VIEW),
  sellerLimiter,
  validate(notificationTypeParamSchema),
  adminNotificationController.getTemplate,
);

router.put(
  "/templates/:type",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_NOTIFICATIONS_MANAGE),
  sellerLimiter,
  validate(upsertTemplateSchema),
  adminNotificationController.upsertTemplate,
);

router.delete(
  "/templates/:type",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_NOTIFICATIONS_MANAGE),
  sellerLimiter,
  validate(notificationTypeParamSchema),
  adminNotificationController.revertTemplate,
);

router.get(
  "/deliveries",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_NOTIFICATIONS_VIEW),
  sellerLimiter,
  adminNotificationController.listDeliveries,
);

export default router;

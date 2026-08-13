import { Router } from "express";
import { notificationController } from "./notification.controller";
import { protect, protectSse } from "../../middleware/auth";
import { validate } from "../../utils/validate";
import { sellerLimiter, publicLimiter } from "../../middleware/rate-limit";
import {
  markAsReadSchema,
  getNotificationsSchema,
  updatePreferencesSchema,
} from "./notification.schema";

const router = Router();

router.get("/stream", protectSse, sellerLimiter, notificationController.stream);
router.get("/stream-token", protect, sellerLimiter, notificationController.getStreamToken);

router.get(
  "/preferences",
  protect,
  publicLimiter,
  notificationController.getPreferences,
);

router.put(
  "/preferences",
  protect,
  sellerLimiter,
  validate(updatePreferencesSchema),
  notificationController.updatePreferences,
);

router.get(
  "/",
  protect,
  publicLimiter,
  validate(getNotificationsSchema),
  notificationController.getNotifications,
);

router.patch(
  "/read",
  protect,
  publicLimiter,
  validate(markAsReadSchema),
  notificationController.markAsRead,
);

router.patch(
  "/read-all",
  protect,
  publicLimiter,
  notificationController.markAllAsRead,
);

export default router;

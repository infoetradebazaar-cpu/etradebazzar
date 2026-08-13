import { Router } from "express";
import { analyticsController } from "./analytics.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePlatformAdminAndPermission, requirePermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS, PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import {
    sellerAnalyticsSchema,
    platformAnalyticsSchema,
    refreshViewSchema,
} from "./analytics.schema";

const router = Router();

// Seller
router.get(
    "/seller",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.ANALYTICS_VIEW),
    validate(sellerAnalyticsSchema),
    analyticsController.getSellerAnalytics
);

router.get(
    "/seller/revenue",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.ANALYTICS_VIEW),
    validate(sellerAnalyticsSchema),
    analyticsController.getSellerDailyRevenue
);

router.get(
    "/seller/products",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.ANALYTICS_VIEW),
    analyticsController.getSellerTopProducts
);

router.get(
    "/seller/returns",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.ANALYTICS_VIEW),
    analyticsController.getSellerReturnRate
);

// Platform Admin
router.get(
    "/platform",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_ANALYTICS_VIEW]),
    validate(platformAnalyticsSchema),
    analyticsController.getPlatformAnalytics
);

router.get(
    "/platform/sellers",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_ANALYTICS_VIEW]),
    analyticsController.getTopSellers
);

// Admin: manual refresh
router.post(
    "/refresh",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ANALYTICS_REFRESH]),
    analyticsController.refreshAllViews
);

router.post(
    "/refresh/:viewName",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ANALYTICS_REFRESH]),
    validate(refreshViewSchema),
    analyticsController.refreshView
);

export default router;
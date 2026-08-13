import { Router } from "express";
import { couponController } from "./coupon.controller";
import { protect } from "../../middleware/auth";
import { requirePlatformAdminAndPermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter, publicLimiter } from "../../middleware/rate-limit";
import {
    createCouponSchema, bulkGenerateCouponSchema, validateCouponSchema,
    updateCouponSchema, couponParamSchema, listCouponsSchema,
} from "./coupon.schema";

const router = Router();

// Customer coupon at checkout
router.post(
    "/validate",
    protect,
    publicLimiter,
    validate(validateCouponSchema),
    couponController.validateCoupon
);

// Platform admin
router.post(
    "/",
    protect,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_COUPONS_MANAGE]),
    sellerLimiter,
    validate(createCouponSchema),
    couponController.createCoupon
);

router.post(
    "/bulk-generate",
    protect,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_COUPONS_MANAGE]),
    sellerLimiter,
    validate(bulkGenerateCouponSchema),
    couponController.bulkGenerateCoupons
);

router.get(
    "/",
    protect,
    requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_COUPONS_VIEW]),
    sellerLimiter,
    validate(listCouponsSchema),
    couponController.listCoupons
);

router.get(
    "/:couponId",
    protect,
    requirePlatformAdminAndPermission(["super_admin", "onboarding_manager"], [PLATFORM_PERMISSIONS.PLATFORM_COUPONS_VIEW]),
    sellerLimiter,
    validate(couponParamSchema),
    couponController.getCoupon
);

router.patch(
    "/:couponId",
    protect,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_COUPONS_MANAGE]),
    sellerLimiter,
    validate(updateCouponSchema),
    couponController.updateCoupon
);

router.patch(
    "/:couponId/deactivate",
    protect,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_COUPONS_MANAGE]),
    sellerLimiter,
    validate(couponParamSchema),
    couponController.deactivateCoupon
);

export default router;
import { Router } from "express";
import multer from "multer";
import { reviewController } from "./review.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePlatformAdminAndPermission, requirePermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS, PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { publicLimiter, sellerLimiter, uploadLimiter } from "../../middleware/rate-limit";
import {
    createReviewSchema, replyReviewSchema, moderateReviewSchema,
    reviewParamSchema, productReviewsSchema,
} from "./review.schema";

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});

// Public
router.get(
    "/product/:productId",
    publicLimiter,
    validate(productReviewsSchema),
    reviewController.getProductReviews
);

// Customer
router.post(
    "/",
    protect,
    uploadLimiter,
    upload.array("media", 5),
    validate(createReviewSchema),
    reviewController.createReview
);

router.post(
    "/:reviewId/helpful",
    protect,
    sellerLimiter,
    validate(reviewParamSchema),
    reviewController.markHelpful
);

// Seller
router.get(
    "/seller",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.REVIEWS_VIEW),
    reviewController.getSellerReviews
);

router.patch(
    "/:reviewId/reply",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.REVIEWS_MANAGE),
    validate(replyReviewSchema),
    reviewController.replyToReview
);

// Platform admin
router.get(
    "/pending",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_REVIEWS_MODERATE]),
    reviewController.listPendingReviews
);

router.patch(
    "/:reviewId/moderate",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_REVIEWS_MODERATE]),
    validate(moderateReviewSchema),
    reviewController.moderateReview
);

export default router;
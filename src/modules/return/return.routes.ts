import { Router } from "express";
import { returnController } from "./return.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePermission, requirePlatformPermission } from "../../middleware/permission";
import { PERMISSIONS, PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter, publicLimiter } from "../../middleware/rate-limit";
import {
    createReturnSchema,
    returnParamSchema,
    reviewReturnSchema,
    rejectReturnSchema,
} from "./return.schema";

const router = Router();

//Customer
router.post(
    "/",
    protect,
    publicLimiter,
    validate(createReturnSchema),
    returnController.createReturnRequest
);

router.get(
    "/my",
    protect,
    publicLimiter,
    returnController.listCustomerReturns
);

// Platform admin - platform-wide, not seller-scoped. Registered before the
// seller "/" and "/:returnId" routes below so "/all" and "/all/:returnId"
// aren't shadowed by "/:returnId" matching "all" as a param value.
router.get(
    "/all",
    protect,
    requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_RETURNS_VIEW),
    sellerLimiter,
    returnController.listAllReturnRequests
);

router.get(
    "/all/:returnId",
    protect,
    requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_RETURNS_VIEW),
    sellerLimiter,
    validate(returnParamSchema),
    returnController.getReturnRequestForAdmin
);

// Seller
router.get(
    "/",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.RETURNS_VIEW),
    returnController.listReturnRequests
);

router.get(
    "/:returnId",
    protect,
    resolveTenant,
    publicLimiter,
    requirePermission(PERMISSIONS.RETURNS_VIEW),
    validate(returnParamSchema),
    returnController.getReturnRequest
);

router.patch(
    "/:returnId/approve",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.RETURNS_MANAGE),
    validate(reviewReturnSchema),
    returnController.approveReturn
);

router.patch(
    "/:returnId/reject",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.RETURNS_MANAGE),
    validate(rejectReturnSchema),
    returnController.rejectReturn
);

export default router;
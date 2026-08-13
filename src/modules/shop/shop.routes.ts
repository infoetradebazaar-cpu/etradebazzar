import { Router } from "express";
import { shopController } from "./shop.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePlatformAdminAndPermission, requirePermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS, PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import {
  createShopSchema,
  updateShopSchema,
  shopParamSchema,
  setAutoAssignSchema,
} from "./shop.schema";
import { memberParamSchema, setShopAccessSchema } from "./shop-access.schema";
import { shopAccessController } from "./shop-access.controller";

const router = Router();

// Platform Admin - list all shops
router.get(
  "/all",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_SHOPS_VIEW]),
  shopController.listAllShops,
);

// seller (tenant)
router.post(
  "/",
  protect,
  resolveTenant,
  requirePermission(PERMISSIONS.SHOPS_MANAGE),
  validate(createShopSchema),
  shopController.createShop,
);

router.get(
  "/",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SHOPS_VIEW),
  shopController.listShops,
);

router.get(
  "/:shopId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SHOPS_VIEW),
  validate(shopParamSchema),
  shopController.getShop,
);

router.patch(
  "/:shopId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SHOPS_MANAGE),
  validate(updateShopSchema),
  shopController.updateShop,
);

router.put(
  "/access/:memberId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SHOPS_MANAGE),
  validate(setShopAccessSchema), shopAccessController.setShopAccess
);

router.get(
  "/access/:memberId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SHOPS_MANAGE),
  validate(memberParamSchema), shopAccessController.getMemberShopAccess
);

router.patch(
  "/:shopId/auto-assign",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.SHOPS_ADMIN),
  validate(setAutoAssignSchema),
  shopController.setAutoAssign
);

export default router;

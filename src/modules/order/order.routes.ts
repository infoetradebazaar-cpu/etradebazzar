import { Router } from "express";
import multer from "multer";
import { orderController } from "./order.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePlatformAdminAndPermission, requirePermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS, PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import {
  sellerLimiter,
  publicLimiter,
  uploadLimiter,
} from "../../middleware/rate-limit";
import {
  createOrderSchema,
  assignShopSchema,
  orderParamSchema,
  bulkOrderActionSchema,
  listAllOrdersSchema,
  markPackedSchema,
  cancelOrderSchema,
  adminAssignShopSchema,
} from "./order.schema";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Static routes (must be before /:orderId to avoid shadowing)
router.get(
  "/export",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.ORDERS_MANAGE),
  orderController.exportOrdersCsv,
);

router.get(
  "/action-required",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.ORDERS_FULFILL),
  orderController.getActionRequired,
);

router.get(
  "/bulk-uploads",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.ORDERS_FULFILL),
  orderController.listBulkUploads,
);

router.get(
  "/all",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ORDERS_VIEW_ALL]),
  validate(listAllOrdersSchema),
  orderController.listAllOrders,
);

router.patch(
  "/:orderId/assign",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_ORDERS_ASSIGN]),
  validate(adminAssignShopSchema),
  orderController.adminAssignShop,
);

router.post(
  "/bulk-action",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.ORDERS_MANAGE),
  validate(bulkOrderActionSchema),
  orderController.bulkAction,
);

//Customer
router.post(
  "/",
  protect,
  publicLimiter,
  validate(createOrderSchema),
  orderController.createOrder,
);

router.post(
  "/bulk",
  protect,
  uploadLimiter,
  upload.single("file"),
  orderController.createBulkOrder,
);

router.get(
  "/:orderId",
  protect,
  resolveTenant,
  publicLimiter,
  validate(orderParamSchema),
  orderController.getOrder,
);

router.patch(
  "/:orderId/cancel",
  protect,
  resolveTenant,
  publicLimiter,
  validate(cancelOrderSchema),
  orderController.cancelOrder,
);

router.patch(
  "/:orderId/pack",
  protect,
  resolveTenant,
  sellerLimiter,
  requirePermission(PERMISSIONS.ORDERS_FULFILL),
  validate(markPackedSchema),
  orderController.markPacked,
);

// Seller
router.get(
  "/",
  protect,
  resolveTenant,
  sellerLimiter,
  requirePermission(PERMISSIONS.ORDERS_FULFILL),
  orderController.listOrders,
);

router.patch(
  "/:orderId/addresses/:addressId/assign",
  protect,
  resolveTenant,
  sellerLimiter,
  requirePermission(PERMISSIONS.ORDERS_FULFILL),
  validate(assignShopSchema),
  orderController.assignShopToAddress,
);

export default router;

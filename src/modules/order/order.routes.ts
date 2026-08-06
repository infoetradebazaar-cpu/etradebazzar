import { Router } from "express";
import multer from "multer";
import { orderController } from "./order.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant, requirePlatformAdmin } from "../../middleware/tenant";
import { requireSellerRole } from "../../middleware/rbac";
import { validate } from "../../utils/validate";
import {
  sellerLimiter,
  publicLimiter,
  uploadLimiter,
} from "../../middleware/rate-limit";
import {
  createOrderSchema,
  submitProposalSchema,
  respondProposalSchema,
  assignShopSchema,
  orderParamSchema,
  setThresholdSchema,
  setCommissionSchema,
  bulkOrderActionSchema,
  bulkRespondNegotiationsSchema,
  listAllOrdersSchema,
  markPackedSchema,
  cancelOrderSchema,
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
  requireSellerRole("owner", "manager"),
  orderController.exportOrdersCsv,
);

router.get(
  "/action-required",
  protect,
  sellerLimiter,
  resolveTenant,
  requireSellerRole("owner", "manager", "staff"),
  orderController.getActionRequired,
);

router.get(
  "/bulk-uploads",
  protect,
  sellerLimiter,
  resolveTenant,
  requireSellerRole("owner", "manager", "staff"),
  orderController.listBulkUploads,
);

router.get(
  "/all",
  protect,
  sellerLimiter,
  requirePlatformAdmin("super_admin"),
  validate(listAllOrdersSchema),
  orderController.listAllOrders,
);

router.post(
  "/bulk-action",
  protect,
  sellerLimiter,
  resolveTenant,
  requireSellerRole("owner", "manager"),
  validate(bulkOrderActionSchema),
  orderController.bulkAction,
);

router.post(
  "/negotiate/bulk-respond",
  protect,
  sellerLimiter,
  resolveTenant,
  requireSellerRole("owner", "manager"),
  validate(bulkRespondNegotiationsSchema),
  orderController.bulkRespondNegotiations,
);

router.post(
  "/threshold",
  protect,
  resolveTenant,
  sellerLimiter,
  requireSellerRole("owner"),
  validate(setThresholdSchema),
  orderController.setThreshold,
);

router.get(
  "/threshold",
  protect,
  resolveTenant,
  sellerLimiter,
  requireSellerRole("owner", "manager"),
  orderController.getThresholds,
);

router.delete(
  "/threshold/:productCategory",
  protect,
  resolveTenant,
  sellerLimiter,
  requireSellerRole("owner"),
  orderController.deleteThreshold,
);

router.post(
  "/commission",
  protect,
  sellerLimiter,
  requirePlatformAdmin("super_admin"),
  validate(setCommissionSchema),
  orderController.setCommission,
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

router.post(
  "/:orderId/negotiate",
  protect,
  resolveTenant,
  validate(submitProposalSchema),
  publicLimiter,
  orderController.submitProposalAsCustomer,
);

router.patch(
  "/:orderId/negotiate/:negotiationId",
  protect,
  resolveTenant,
  publicLimiter,
  validate(respondProposalSchema),
  orderController.respondToProposal,
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
  requireSellerRole("owner", "manager", "staff"),
  validate(markPackedSchema),
  orderController.markPacked,
);

// Seller
router.get(
  "/",
  protect,
  resolveTenant,
  sellerLimiter,
  requireSellerRole("owner", "manager", "staff"),
  orderController.listOrders,
);

router.post(
  "/:orderId/negotiate/proposal",
  sellerLimiter,
  protect,
  resolveTenant,
  requireSellerRole("owner", "manager"),
  validate(submitProposalSchema),
  orderController.submitProposalAsSeller,
);

router.patch(
  "/:orderId/addresses/:addressId/assign",
  protect,
  resolveTenant,
  sellerLimiter,
  requireSellerRole("owner", "manager", "staff"),
  validate(assignShopSchema),
  orderController.assignShopToAddress,
);

export default router;

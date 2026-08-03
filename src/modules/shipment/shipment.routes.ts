import { Router } from "express";
import { shipmentController } from "./shipment.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant, requirePlatformAdmin } from "../../middleware/tenant";
import { requireSellerRole } from "../../middleware/rbac";
import { sellerLimiter, publicLimiter } from "../../middleware/rate-limit";
import express from "express";
import { validate } from "../../utils/validate";
import {
    bulkCancelShipmentsSchema,
    shipmentParamSchema,
    serviceabilitySchema,
    listAllShipmentsSchema,
} from "./shipment.schema";
const router = Router();

//Platform admin
router.get(
    "/with-orders",
    protect,
    sellerLimiter,
    requirePlatformAdmin("super_admin"),
    shipmentController.listShipmentsWithOrders
);

router.get(
    "/",
    protect,
    sellerLimiter,
    requirePlatformAdmin("super_admin"),
    validate(listAllShipmentsSchema),
    shipmentController.listShipments
);

router.get(
    "/serviceability",
    protect,
    sellerLimiter,
    resolveTenant,
    requireSellerRole("owner", "manager", "staff"),
    validate(serviceabilitySchema),
    shipmentController.checkServiceability
);

router.get(
    "/:shipmentId/with-order",
    protect,
    sellerLimiter,
    requirePlatformAdmin("super_admin"),
    validate(shipmentParamSchema),
    shipmentController.getShipmentWithOrder
);

router.get(
    "/:shipmentId",
    protect,
    sellerLimiter,
    requirePlatformAdmin("super_admin"),
    validate(shipmentParamSchema),
    shipmentController.getShipment
);

router.get(
    "/:shipmentId/track",
    protect,
    publicLimiter,
    resolveTenant,
    validate(shipmentParamSchema),
    shipmentController.trackShipment
);

router.patch(
    "/:shipmentId/cancel",
    protect,
    sellerLimiter,
    resolveTenant,
    requireSellerRole("owner", "manager"),
    validate(shipmentParamSchema),
    shipmentController.cancelShipment
);

router.post(
    "/bulk-cancel",
    protect,
    sellerLimiter,
    resolveTenant,
    requireSellerRole("owner", "manager"),
    validate(bulkCancelShipmentsSchema),
    shipmentController.bulkCancel
);

router.get(
    "/export",
    protect,
    sellerLimiter,
    requirePlatformAdmin("super_admin"),
    shipmentController.exportShipmentsCsv
);

router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    shipmentController.handleWebhook
);
export default router;
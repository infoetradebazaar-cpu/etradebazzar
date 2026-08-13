import { Router } from "express";
import { shipmentController } from "./shipment.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePlatformAdminAndPermission, requirePermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS, PERMISSIONS } from "../../lib/permission/permission.constants";
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
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_SHIPMENTS_VIEW]),
    shipmentController.listShipmentsWithOrders
);

router.get(
    "/",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_SHIPMENTS_VIEW]),
    validate(listAllShipmentsSchema),
    shipmentController.listShipments
);

router.get(
    "/serviceability",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.SHIPMENTS_VIEW),
    validate(serviceabilitySchema),
    shipmentController.checkServiceability
);

router.get(
    "/:shipmentId/with-order",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_SHIPMENTS_VIEW]),
    validate(shipmentParamSchema),
    shipmentController.getShipmentWithOrder
);

router.get(
    "/:shipmentId",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_SHIPMENTS_VIEW]),
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
    requirePermission(PERMISSIONS.SHIPMENTS_MANAGE),
    validate(shipmentParamSchema),
    shipmentController.cancelShipment
);

router.post(
    "/bulk-cancel",
    protect,
    sellerLimiter,
    resolveTenant,
    requirePermission(PERMISSIONS.SHIPMENTS_MANAGE),
    validate(bulkCancelShipmentsSchema),
    shipmentController.bulkCancel
);

router.get(
    "/export",
    protect,
    sellerLimiter,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_SHIPMENTS_VIEW]),
    shipmentController.exportShipmentsCsv
);

router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    shipmentController.handleWebhook
);
export default router;
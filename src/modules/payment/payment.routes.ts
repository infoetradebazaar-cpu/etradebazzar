import { Router } from "express";
import express from "express";
import { paymentController } from "./payment.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { verifyOrderAccess } from "../../middleware/order-access";
import { requirePlatformAdminAndPermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { paymentLimiter, publicLimiter } from "../../middleware/rate-limit";
import {
    verifyPaymentSchema,
    orderPaymentParamSchema,
    recordManualPaymentSchema,
    setOnlinePaymentsEnabledSchema,
} from "./payment.schema";

const router = Router();

router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    paymentController.webhook
);
router.get(
    "/config/online-enabled",
    publicLimiter,
    paymentController.getOnlinePaymentsEnabled
);
router.post(
    "/config/online-enabled",
    protect,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_PAYMENTS_CONFIG]),
    paymentLimiter,
    validate(setOnlinePaymentsEnabledSchema),
    paymentController.setOnlinePaymentsEnabled
);

router.post(
    "/orders/:orderId/manual",
    protect,
    requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_PAYMENTS_RECORD_MANUAL]),
    paymentLimiter,
    validate(recordManualPaymentSchema),
    paymentController.recordManualPayment
);

router.post(
    "/orders/:orderId/advance",
    protect,
    resolveTenant,
    paymentLimiter,
    validate(orderPaymentParamSchema),
    verifyOrderAccess,
    paymentController.createAdvancePayment
);

router.post(
    "/orders/:orderId/final",
    protect,
    resolveTenant,
    paymentLimiter,
    validate(orderPaymentParamSchema),
    verifyOrderAccess,
    paymentController.createFinalPayment
);

router.post(
    "/verify",
    protect,
    resolveTenant,
    paymentLimiter,
    validate(verifyPaymentSchema),
    paymentController.verifyPayment
);

router.post(
    "/orders/:orderId/refund",
    protect,
    resolveTenant,
    paymentLimiter,
    validate(orderPaymentParamSchema),
    verifyOrderAccess,
    paymentController.initiateRefund
);

router.get(
    "/orders/:orderId",
    protect,
    resolveTenant,
    publicLimiter,
    validate(orderPaymentParamSchema),
    verifyOrderAccess,
    paymentController.getPayments
);

export default router;
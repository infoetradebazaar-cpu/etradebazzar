import { Router } from "express";
import { invoicingController } from "./invoicing.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePermissionIfSeller, requirePlatformPermission } from "../../middleware/permission";
import { PERMISSIONS, PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import { orderIdParamSchema, listBillingDocumentsSchema, listMyBillingDocumentsSchema, invoiceIdParamSchema, poIdParamSchema } from "./invoicing.schema";

export const invoiceRoutes = Router();

invoiceRoutes.get(
  "/",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  validate(listBillingDocumentsSchema),
  invoicingController.listInvoicesAdmin,
);

invoiceRoutes.get(
  "/admin/:invoiceId",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  invoicingController.getInvoiceAdmin,
);

invoiceRoutes.get(
  "/admin/:invoiceId/pdf",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  invoicingController.downloadInvoicePdfAdmin,
);

invoiceRoutes.post(
  "/orders/:orderId/generate",
  protect,
  resolveTenant,
  requirePermissionIfSeller(PERMISSIONS.INVOICES_MANAGE),
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.generateInvoice,
);

invoiceRoutes.get(
  "/mine",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(listMyBillingDocumentsSchema),
  invoicingController.listMyInvoices,
);

invoiceRoutes.get(
  "/mine/:invoiceId/pdf",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(invoiceIdParamSchema),
  invoicingController.downloadMyInvoicePdf,
);

invoiceRoutes.get(
  "/orders/:orderId",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.getInvoice,
);

invoiceRoutes.get(
  "/orders/:orderId/pdf",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.downloadInvoicePdf,
);

export const purchaseOrderRoutes = Router();

purchaseOrderRoutes.get(
  "/",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  validate(listBillingDocumentsSchema),
  invoicingController.listPurchaseOrdersAdmin,
);

purchaseOrderRoutes.get(
  "/admin/:poId",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  invoicingController.getPurchaseOrderAdmin,
);

purchaseOrderRoutes.get(
  "/admin/:poId/pdf",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  invoicingController.downloadPurchaseOrderPdfAdmin,
);

purchaseOrderRoutes.post(
  "/orders/:orderId/generate",
  protect,
  resolveTenant,
  requirePermissionIfSeller(PERMISSIONS.INVOICES_MANAGE),
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.generatePurchaseOrder,
);

purchaseOrderRoutes.get(
  "/mine",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(listMyBillingDocumentsSchema),
  invoicingController.listMyPurchaseOrders,
);

purchaseOrderRoutes.get(
  "/mine/:poId/pdf",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(poIdParamSchema),
  invoicingController.downloadMyPurchaseOrderPdf,
);

purchaseOrderRoutes.get(
  "/orders/:orderId",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.getPurchaseOrder,
);

purchaseOrderRoutes.get(
  "/orders/:orderId/pdf",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.downloadPurchaseOrderPdf,
);

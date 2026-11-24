import { Router } from "express";
import { invoicingController } from "./invoicing.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePermissionIfSeller, requirePlatformPermission } from "../../middleware/permission";
import { PERMISSIONS, PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import { orderIdParamSchema, listBillingDocumentsSchema, listMyBillingDocumentsSchema, invoiceIdParamSchema, poIdParamSchema, quotationIdParamSchema, proformaInvoiceIdParamSchema } from "./invoicing.schema";

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

export const quotationRoutes = Router();

quotationRoutes.get(
  "/",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  validate(listBillingDocumentsSchema),
  invoicingController.listQuotationsAdmin,
);

quotationRoutes.get(
  "/admin/:quotationId",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  invoicingController.getQuotationAdmin,
);

quotationRoutes.get(
  "/admin/:quotationId/pdf",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  invoicingController.downloadQuotationPdfAdmin,
);

quotationRoutes.post(
  "/orders/:orderId/generate",
  protect,
  resolveTenant,
  requirePermissionIfSeller(PERMISSIONS.INVOICES_MANAGE),
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.generateQuotation,
);

quotationRoutes.get(
  "/mine",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(listMyBillingDocumentsSchema),
  invoicingController.listMyQuotations,
);

quotationRoutes.get(
  "/mine/:quotationId/pdf",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(quotationIdParamSchema),
  invoicingController.downloadMyQuotationPdf,
);

quotationRoutes.get(
  "/orders/:orderId",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.getQuotation,
);

quotationRoutes.get(
  "/orders/:orderId/pdf",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.downloadQuotationPdf,
);

export const proformaInvoiceRoutes = Router();

proformaInvoiceRoutes.get(
  "/",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  validate(listBillingDocumentsSchema),
  invoicingController.listProformaInvoicesAdmin,
);

proformaInvoiceRoutes.get(
  "/admin/:piId",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  invoicingController.getProformaInvoiceAdmin,
);

proformaInvoiceRoutes.get(
  "/admin/:piId/pdf",
  protect,
  requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_INVOICES_VIEW),
  sellerLimiter,
  invoicingController.downloadProformaInvoicePdfAdmin,
);

proformaInvoiceRoutes.post(
  "/orders/:orderId/generate",
  protect,
  resolveTenant,
  requirePermissionIfSeller(PERMISSIONS.INVOICES_MANAGE),
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.generateProformaInvoice,
);

proformaInvoiceRoutes.get(
  "/orders/:orderId/bank-details",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.getBankTransferDetails,
);

proformaInvoiceRoutes.get(
  "/mine",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(listMyBillingDocumentsSchema),
  invoicingController.listMyProformaInvoices,
);

proformaInvoiceRoutes.get(
  "/mine/:piId/pdf",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(proformaInvoiceIdParamSchema),
  invoicingController.downloadMyProformaInvoicePdf,
);

proformaInvoiceRoutes.get(
  "/orders/:orderId",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.getProformaInvoice,
);

proformaInvoiceRoutes.get(
  "/orders/:orderId/pdf",
  protect,
  resolveTenant,
  sellerLimiter,
  validate(orderIdParamSchema),
  invoicingController.downloadProformaInvoicePdf,
);
import type { Request, Response } from "express";
import { invoicingService } from "./invoicing.service";
import { logger } from "../../utils/logger";

function actorFrom(req: Request) {
    return {
        userId: req.user!.id,
        sellerId: req.seller?.id,
        actorType: (req.seller ? "seller" : "buyer") as "seller" | "buyer",
    };
}

function classifyError(res: Response, error: any, label: string) {
    logger.error({ err: error.message }, label);
    if (
        error.message === "Order not found" ||
        error.message === "Invoice not found" ||
        error.message === "Purchase order not found" ||
        error.message === "Quotation not found" ||
        error.message === "Proforma invoice not found" ||
        error.message === "Bank details not found"
    ) {
        return res.status(404).json({ success: false, error: error.message });
    }
    if (
        error.message.startsWith("Cannot generate invoice") ||
        error.message.startsWith("Cannot generate purchase order") ||
        error.message.startsWith("Cannot generate quotation") ||
        error.message.startsWith("Cannot generate proforma invoice") ||
        error.message.startsWith("Proforma invoice is issued only after")
    ) {
        return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: "Internal server error" });
}

export const invoicingController = {
    async generateInvoice(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.generateInvoice(orderId as string, actorFrom(req));
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Generate invoice failed");
        }
    },

    async getInvoice(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.getInvoiceForOrder(orderId as string, actorFrom(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get invoice failed");
        }
    },

    async downloadInvoicePdf(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const buffer = await invoicingService.renderInvoicePdf(orderId as string, actorFrom(req));
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=invoice-${orderId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download invoice pdf failed");
        }
    },

    async generatePurchaseOrder(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.generatePurchaseOrder(orderId as string, actorFrom(req));
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Generate purchase order failed");
        }
    },

    async getPurchaseOrder(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.getPurchaseOrderForOrder(orderId as string, actorFrom(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get purchase order failed");
        }
    },

    async downloadPurchaseOrderPdf(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const buffer = await invoicingService.renderPurchaseOrderPdf(orderId as string, actorFrom(req));
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=purchase-order-${orderId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download purchase order pdf failed");
        }
    },
    
    async generateQuotation(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.generateQuotation(orderId as string, actorFrom(req));
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Generate quotation failed");
        }
    },

    async getQuotation(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.getQuotationForOrder(orderId as string, actorFrom(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get quotation failed");
        }
    },

    async downloadQuotationPdf(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const buffer = await invoicingService.renderQuotationPdf(orderId as string, actorFrom(req));
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=quotation-${orderId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download quotation pdf failed");
        }
    },

    async getBankTransferDetails(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.getBankTransferDetails(orderId as string, actorFrom(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get bank transfer details failed");
        }
    },

    async generateProformaInvoice(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.generateProformaInvoice(orderId as string, actorFrom(req));
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Generate proforma invoice failed");
        }
    },

    async getProformaInvoice(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await invoicingService.getProformaInvoiceForOrder(orderId as string, actorFrom(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get proforma invoice failed");
        }
    },

    async downloadProformaInvoicePdf(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const buffer = await invoicingService.renderProformaInvoicePdf(orderId as string, actorFrom(req));
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=proforma-invoice-${orderId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download proforma invoice pdf failed");
        }
    },

    async getInvoiceAdmin(req: Request, res: Response) {
        try {
            const { invoiceId } = req.params;
            const result = await invoicingService.getInvoiceAdmin(invoiceId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get invoice (admin) failed");
        }
    },

    async downloadInvoicePdfAdmin(req: Request, res: Response) {
        try {
            const { invoiceId } = req.params;
            const buffer = await invoicingService.renderInvoicePdfAdmin(invoiceId as string);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=invoice-${invoiceId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download invoice pdf (admin) failed");
        }
    },

    async getPurchaseOrderAdmin(req: Request, res: Response) {
        try {
            const { poId } = req.params;
            const result = await invoicingService.getPurchaseOrderAdmin(poId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get purchase order (admin) failed");
        }
    },

    async downloadPurchaseOrderPdfAdmin(req: Request, res: Response) {
        try {
            const { poId } = req.params;
            const buffer = await invoicingService.renderPurchaseOrderPdfAdmin(poId as string);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=purchase-order-${poId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download purchase order pdf (admin) failed");
        }
    },

    async getQuotationAdmin(req: Request, res: Response) {
        try {
            const { quotationId } = req.params;
            const result = await invoicingService.getQuotationAdmin(quotationId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get quotation (admin) failed");
        }
    },

    async downloadQuotationPdfAdmin(req: Request, res: Response) {
        try {
            const { quotationId } = req.params;
            const buffer = await invoicingService.renderQuotationPdfAdmin(quotationId as string);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=quotation-${quotationId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download quotation pdf (admin) failed");
        }
    },

    async getProformaInvoiceAdmin(req: Request, res: Response) {
        try {
            const { piId } = req.params;
            const result = await invoicingService.getProformaInvoiceAdmin(piId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get proforma invoice (admin) failed");
        }
    },

    async downloadProformaInvoicePdfAdmin(req: Request, res: Response) {
        try {
            const { piId } = req.params;
            const buffer = await invoicingService.renderProformaInvoicePdfAdmin(piId as string);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=proforma-invoice-${piId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download proforma invoice pdf (admin) failed");
        }
    },

    async listMyProformaInvoices(req: Request, res: Response) {
        if (!req.seller) return res.status(403).json({ success: false, error: "Seller context required" });
        try {
            const { page, limit } = req.query as Record<string, string>;
            const result = await invoicingService.listProformaInvoicesAdmin({
                sellerId: req.seller.id,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List my proforma invoices failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async downloadMyProformaInvoicePdf(req: Request, res: Response) {
        if (!req.seller) return res.status(403).json({ success: false, error: "Seller context required" });
        try {
            const { piId } = req.params;
            const pi = await invoicingService.getProformaInvoiceAdmin(piId as string);
            if (pi.sellerId !== req.seller.id) {
                return res.status(404).json({ success: false, error: "Proforma invoice not found" });
            }
            const buffer = await invoicingService.renderProformaInvoicePdfAdmin(piId as string);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=proforma-invoice-${piId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download my proforma invoice pdf failed");
        }
    },

    async listProformaInvoicesAdmin(req: Request, res: Response) {
        try {
            const { sellerId, page, limit } = req.query as Record<string, string>;
            const result = await invoicingService.listProformaInvoicesAdmin({
                sellerId,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List proforma invoices (admin) failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listInvoicesAdmin(req: Request, res: Response) {
        try {
            const { sellerId, page, limit } = req.query as Record<string, string>;
            const result = await invoicingService.listInvoicesAdmin({
                sellerId,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List invoices (admin) failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listMyInvoices(req: Request, res: Response) {
        if (!req.seller) return res.status(403).json({ success: false, error: "Seller context required" });
        try {
            const { page, limit } = req.query as Record<string, string>;
            const result = await invoicingService.listInvoicesAdmin({
                sellerId: req.seller.id,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List my invoices failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listMyPurchaseOrders(req: Request, res: Response) {
        if (!req.seller) return res.status(403).json({ success: false, error: "Seller context required" });
        try {
            const { page, limit } = req.query as Record<string, string>;
            const result = await invoicingService.listPurchaseOrdersAdmin({
                sellerId: req.seller.id,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List my purchase orders failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listMyQuotations(req: Request, res: Response) {
        if (!req.seller) return res.status(403).json({ success: false, error: "Seller context required" });
        try {
            const { page, limit } = req.query as Record<string, string>;
            const result = await invoicingService.listQuotationsAdmin({
                sellerId: req.seller.id,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List my quotations failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async downloadMyQuotationPdf(req: Request, res: Response) {
        if (!req.seller) return res.status(403).json({ success: false, error: "Seller context required" });
        try {
            const { quotationId } = req.params;
            const quotation = await invoicingService.getQuotationAdmin(quotationId as string);
            if (quotation.sellerId !== req.seller.id) {
                return res.status(404).json({ success: false, error: "Quotation not found" });
            }
            const buffer = await invoicingService.renderQuotationPdfAdmin(quotationId as string);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=quotation-${quotationId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download my quotation pdf failed");
        }
    },

    async listQuotationsAdmin(req: Request, res: Response) {
        try {
            const { sellerId, page, limit } = req.query as Record<string, string>;
            const result = await invoicingService.listQuotationsAdmin({
                sellerId,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List quotations (admin) failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async downloadMyInvoicePdf(req: Request, res: Response) {
        if (!req.seller) return res.status(403).json({ success: false, error: "Seller context required" });
        try {
            const { invoiceId } = req.params;
            const invoice = await invoicingService.getInvoiceAdmin(invoiceId as string);
            if (invoice.sellerId !== req.seller.id) {
                return res.status(404).json({ success: false, error: "Invoice not found" });
            }
            const buffer = await invoicingService.renderInvoicePdfAdmin(invoiceId as string);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=invoice-${invoiceId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download my invoice pdf failed");
        }
    },

    async downloadMyPurchaseOrderPdf(req: Request, res: Response) {
        if (!req.seller) return res.status(403).json({ success: false, error: "Seller context required" });
        try {
            const { poId } = req.params;
            const po = await invoicingService.getPurchaseOrderAdmin(poId as string);
            if (po.sellerId !== req.seller.id) {
                return res.status(404).json({ success: false, error: "Purchase order not found" });
            }
            const buffer = await invoicingService.renderPurchaseOrderPdfAdmin(poId as string);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=purchase-order-${poId}.pdf`);
            return res.send(buffer);
        } catch (error: any) {
            return classifyError(res, error, "Download my purchase order pdf failed");
        }
    },

    async listPurchaseOrdersAdmin(req: Request, res: Response) {
        try {
            const { sellerId, page, limit } = req.query as Record<string, string>;
            const result = await invoicingService.listPurchaseOrdersAdmin({
                sellerId,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List purchase orders (admin) failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};

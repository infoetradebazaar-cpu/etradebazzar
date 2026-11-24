import { createHmac } from "crypto";
import { db } from "../../db/index";
import { generateDisplayId } from "../../lib/uid/uid.generator";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { logger } from "../../utils/logger";
import { config } from "../../../config/config";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import * as React from "react";
import { InvoiceDocument } from "../../lib/pdf/templates/invoice.template";
import { PurchaseOrderDocument } from "../../lib/pdf/templates/purchase-order.template";
import { QuotationDocument } from "../../lib/pdf/templates/quotation.template";
import { ProformaInvoiceDocument } from "../../lib/pdf/templates/proforma-invoice.template";
import type {
    BillingDocumentLineItem,
    BillingDocumentParty,
    InvoiceSnapshot,
    PurchaseOrderSnapshot,
    QuotationSnapshot,
    ProformaInvoiceSnapshot,
    BillingBankDetails,
} from "./invoicing.types";
import { decrypt } from "../../utils/encryption";
import { getAdvancePercent, getGatewaySurchargePercent } from "../../lib/payments/payment-terms";

const ASSUMED_GST_RATE = 18;
export const SELLER_APPROVAL_WINDOW_HOURS = 48;

const CLOSED_ORDER_STATUSES = new Set(["CANCELLED", "UNFULFILLABLE"]);

export async function loadSellerBankDetails(sellerId: string): Promise<BillingBankDetails | null> {
    const bank = await db.sellerBankDetail.findUnique({ where: { sellerId } });
    if (!bank) return null;
    let accountNumber: string;
    try {
        accountNumber = decrypt(bank.accountNumber);
    } catch {
        logger.error({ sellerId }, "Could not decrypt seller bank account for billing document");
        return null;
    }
    return {
        accountHolderName: bank.verifiedAccountHolderName ?? bank.accountHolderName,
        bankName: bank.bankName,
        accountNumber,
        ifscCode: bank.ifscCode,
        gatewaySurchargePercent: await getGatewaySurchargePercent(),
    };
}

async function buildQuotationTerms(): Promise<string[]> {
    const [advance, surcharge] = await Promise.all([getAdvancePercent(), getGatewaySurchargePercent()]);
    return [
        "Prices are final as negotiated and agreed by both parties.",
        `Payment: ${advance}% advance to confirm the order; balance before dispatch.`,
        `Bank transfer (RTGS/NEFT) has no extra charge. Online gateway payments carry a ${surcharge}% surcharge, which is non-refundable.`,
        "A proforma invoice is issued once the advance payment is confirmed.",
        "Orders with custom packaging or multiple delivery locations are prepaid only (no cash on delivery).",
        "Delivery timelines start from the date the advance is received.",
    ];
}

function asPdfDocument(element: React.ReactElement): React.ReactElement<DocumentProps> {
    return element as React.ReactElement<DocumentProps>;
}

type BillingDocKind = "invoice" | "purchase-order" | "quotation" | "proforma-invoice";

function billingPdfKey(kind: BillingDocKind, docId: string): string {
    const tag = createHmac("sha256", config.encryptionKey).update(`${kind}:${docId}`).digest("hex").slice(0, 32);
    return `billing-documents/${kind}/${docId}-${tag}.pdf`;
}

async function getOrRenderPdf(kind: BillingDocKind, docId: string, render: () => Promise<Buffer>): Promise<Buffer> {
    const key = billingPdfKey(kind, docId);
    const storage = StorageFactory.get();
    try {
        const stored = await storage.download(key);
        if (stored) return stored;
    } catch (err: any) {
        logger.warn({ err: err.message, key }, "Stored PDF unavailable, rendering instead");
    }

    const pdf = await render();

    storage
        .upload({ key, buffer: pdf, mimeType: "application/pdf", size: pdf.length })
        .catch((err: any) => logger.warn({ err: err.message, key }, "Failed to store rendered PDF"));
    return pdf;
}

export async function loadOrderForBillingDocument(orderId: string) {
    const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
            customer: { select: { id: true, name: true, email: true, phone: true } },
            seller: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    street: true,
                    city: true,
                    state: true,
                    pincode: true,
                    gstin: true,
                },
            },
            addresses: { take: 1, orderBy: { createdAt: "asc" } },
            items: {
                include: {
                    product: { select: { name: true, sku: true } },
                    sku: { select: { sku: true } },
                },
            },
        },
    });
    if (!order) throw new Error("Order not found");
    return order;
}

function assertActorCanAccessOrder(
    order: { customerId: string; sellerId: string },
    actor: { userId: string; sellerId?: string },
) {
    const isBuyer = order.customerId === actor.userId;
    const isOwningSeller = !!actor.sellerId && order.sellerId === actor.sellerId;
    if (!isBuyer && !isOwningSeller) {
        throw new Error("Order not found");
    }
}

export function buildLineItems(order: Awaited<ReturnType<typeof loadOrderForBillingDocument>>): BillingDocumentLineItem[] {
    return order.items.map((item) => {
        const unitPrice = Number(item.finalUnitPrice ?? item.unitPrice);
        return {
            productName: item.product.name,
            sku: item.sku?.sku ?? item.product.sku ?? null,
            quantity: item.quantity,
            unitPrice,
            lineTotal: unitPrice * item.quantity,
        };
    });
}

export function buildSellerParty(order: Awaited<ReturnType<typeof loadOrderForBillingDocument>>): BillingDocumentParty {
    return {
        name: order.seller.name,
        email: order.seller.email,
        phone: order.seller.phone,
        address: {
            street: order.seller.street,
            city: order.seller.city,
            state: order.seller.state,
            pincode: order.seller.pincode,
        },
        gstin: order.seller.gstin,
    };
}

export function buildBuyerParty(order: Awaited<ReturnType<typeof loadOrderForBillingDocument>>): BillingDocumentParty {
    const address = order.addresses[0];
    return {
        name: order.customer.name ?? "Customer",
        email: order.customer.email,
        phone: order.customer.phone ?? address?.phone ?? "",
        address: address
            ? { street: address.street, city: address.city, state: address.state, pincode: address.pincode }
            : { street: "-", city: "-", state: "-", pincode: "-" },
    };
}

export const invoicingService = {
    async generateInvoice(orderId: string, actor: { userId: string; sellerId?: string; actorType: "buyer" | "seller" | "system" }) {
        const order = await loadOrderForBillingDocument(orderId);
        assertActorCanAccessOrder(order, actor);

        const existing = await db.invoice.findUnique({ where: { orderId } });
        if (existing) return existing;

        if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_PAID") {
            throw new Error("Cannot generate invoice: payment has not been captured for this order yet");
        }

        const items = buildLineItems(order);
        const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
        const discountAmount = Number(order.discountAmount ?? 0);
        const grandTotal = Number(order.finalAmount ?? order.totalAmount);
        const hasGstin = !!order.seller.gstin;
        const taxAmount = hasGstin ? grandTotal - grandTotal / (1 + ASSUMED_GST_RATE / 100) : 0;

        const invoiceNumber = await generateDisplayId("invoice");

        const provisionalReasons: string[] = [
            "Billing address is the order's shipping address - this platform does not yet capture a separate billing address.",
        ];
        if (hasGstin) {
            provisionalReasons.unshift(
                `GST amount uses a single assumed ${ASSUMED_GST_RATE}% flat rate on the order total, not a per-item rate by HSN code/category. GST is tiered (0/5/12/18/28%) in reality - this figure is very likely wrong for a mixed-category order and must not be used for GST filing.`,
            );
        }

        const snapshot: InvoiceSnapshot = {
            invoiceNumber,
            orderId: order.id,
            orderDisplayId: order.displayId,
            issuedAt: new Date().toISOString(),
            seller: buildSellerParty(order),
            buyer: buildBuyerParty(order),
            items,
            subtotal,
            discountAmount,
            taxAmount,
            taxRate: hasGstin ? ASSUMED_GST_RATE : 0,
            grandTotal,
            isProvisional: true,
            provisionalReasons,
            bankDetails: await loadSellerBankDetails(order.sellerId),
        };

        try {
            return await db.invoice.create({
                data: {
                    invoiceNumber,
                    orderId: order.id,
                    sellerId: order.sellerId,
                    buyerId: order.customerId,
                    issuedBy: actor.userId,
                    issuedByType: actor.actorType,
                    snapshot: snapshot as any,
                    totalAmount: grandTotal,
                    taxAmount,
                    isProvisional: true,
                },
            });
        } catch (err: any) {
            if (err.code === "P2002") {
                const raced = await db.invoice.findUnique({ where: { orderId } });
                if (raced) return raced;
            }
            throw err;
        }
    },

    async generatePurchaseOrder(
        orderId: string,
        actor: { userId: string; sellerId?: string; actorType: "buyer" | "seller" | "system" },
    ) {
        const order = await loadOrderForBillingDocument(orderId);
        assertActorCanAccessOrder(order, actor);

        const existing = await db.purchaseOrder.findUnique({ where: { orderId } });
        if (existing) return existing;

        if (CLOSED_ORDER_STATUSES.has(order.status)) {
            throw new Error("Cannot generate purchase order: order is cancelled");
        }
        if (!order.sellerApprovedAt) {
            throw new Error("Cannot generate purchase order: seller has not approved the order yet");
        }

        if (
            order.paymentMethod === "ONLINE" &&
            order.paymentStatus !== "PAID" &&
            order.paymentStatus !== "PARTIALLY_PAID"
        ) {
            throw new Error("Cannot generate purchase order: payment has not been captured for this order yet");
        }

        const items = buildLineItems(order);
        const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
        const discountAmount = Number(order.discountAmount ?? 0);
        const grandTotal = Number(order.finalAmount ?? order.totalAmount);
        const address = order.addresses[0];

        const poNumber = await generateDisplayId("purchaseOrder");

        const snapshot: PurchaseOrderSnapshot = {
            poNumber,
            orderId: order.id,
            orderDisplayId: order.displayId,
            issuedAt: new Date().toISOString(),
            orderPlacedAt: order.createdAt.toISOString(),
            bankDetails: await loadSellerBankDetails(order.sellerId),
            seller: buildSellerParty(order),
            buyer: buildBuyerParty(order),
            items,
            subtotal,
            discountAmount,
            grandTotal,
            shippingAddress: address
                ? {
                      receiverName: address.receiverName,
                      phone: address.phone,
                      street: address.street,
                      city: address.city,
                      state: address.state,
                      pincode: address.pincode,
                  }
                : null,
        };

        try {
            return await db.purchaseOrder.create({
                data: {
                    poNumber,
                    orderId: order.id,
                    sellerId: order.sellerId,
                    buyerId: order.customerId,
                    issuedBy: actor.userId,
                    issuedByType: actor.actorType,
                    snapshot: snapshot as any,
                    totalAmount: grandTotal,
                },
            });
        } catch (err: any) {
            if (err.code === "P2002") {
                const raced = await db.purchaseOrder.findUnique({ where: { orderId } });
                if (raced) return raced;
            }
            throw err;
        }
    },

    async generateQuotation(
        orderId: string,
        actor: { userId: string; sellerId?: string; actorType: "buyer" | "seller" | "system" },
    ) {
        const order = await loadOrderForBillingDocument(orderId);
        assertActorCanAccessOrder(order, actor);

        const existing = await db.quotation.findUnique({ where: { orderId } });
        if (existing) return existing;

        const items = buildLineItems(order);
        const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
        const discountAmount = Number(order.discountAmount ?? 0);
        const grandTotal = Number(order.finalAmount ?? order.totalAmount);

        const quotationNumber = await generateDisplayId("quotation");
        const disclaimerText = `This order is subject to seller approval within ${SELLER_APPROVAL_WINDOW_HOURS} working hours of issue (Mon–Sat, 9:00–18:00 IST). If the seller does not approve it within that time, the order will be cancelled and the full amount refunded.`;

        const snapshot: QuotationSnapshot = {
            quotationNumber,
            orderId: order.id,
            orderDisplayId: order.displayId,
            issuedAt: new Date().toISOString(),
            seller: buildSellerParty(order),
            buyer: buildBuyerParty(order),
            items,
            subtotal,
            discountAmount,
            grandTotal,
            disclaimerText,
            terms: await buildQuotationTerms(),
            bankDetails: await loadSellerBankDetails(order.sellerId),
        };

        try {
            return await db.quotation.create({
                data: {
                    quotationNumber,
                    orderId: order.id,
                    sellerId: order.sellerId,
                    buyerId: order.customerId,
                    issuedBy: actor.userId,
                    issuedByType: actor.actorType,
                    snapshot: snapshot as any,
                    totalAmount: grandTotal,
                    disclaimerText,
                },
            });
        } catch (err: any) {
            if (err.code === "P2002") {
                const raced = await db.quotation.findUnique({ where: { orderId } });
                if (raced) return raced;
            }
            throw err;
        }
    },

    async generateProformaInvoice(
        orderId: string,
        actor: { userId: string; sellerId?: string; actorType: "buyer" | "seller" | "system" },
    ) {
        const order = await loadOrderForBillingDocument(orderId);
        assertActorCanAccessOrder(order, actor);

        const existing = await db.proformaInvoice.findUnique({ where: { orderId } });
        if (existing) return existing;

        if (order.paymentStatus === "UNPAID") {
            throw new Error("Proforma invoice is issued only after the advance payment is confirmed");
        }
        const paidRows = await db.payment.findMany({ where: { orderId, status: "PAID" }, select: { amount: true } });
        const amountPaid = paidRows.reduce((sum, p) => sum + Number(p.amount), 0);

        const items = buildLineItems(order);
        const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
        const discountAmount = Number(order.discountAmount ?? 0);
        const grandTotal = Number(order.finalAmount ?? order.totalAmount);

        const piNumber = await generateDisplayId("proformaInvoice");
        const balanceDue = Math.max(0, parseFloat((grandTotal - amountPaid).toFixed(2)));
        const paymentNote = balanceDue > 0
            ? `Advance of Rs. ${amountPaid.toFixed(2)} received. Balance of Rs. ${balanceDue.toFixed(2)} is payable before dispatch.`
            : "Payment received in full. This order is released for fulfillment.";

        const snapshot: ProformaInvoiceSnapshot = {
            piNumber,
            orderId: order.id,
            orderDisplayId: order.displayId,
            issuedAt: new Date().toISOString(),
            seller: buildSellerParty(order),
            buyer: buildBuyerParty(order),
            items,
            subtotal,
            discountAmount,
            grandTotal,
            paymentNote,
            amountPaid,
            balanceDue,
            bankDetails: await loadSellerBankDetails(order.sellerId),
        };

        try {
            return await db.proformaInvoice.create({
                data: {
                    piNumber,
                    orderId: order.id,
                    sellerId: order.sellerId,
                    buyerId: order.customerId,
                    issuedBy: actor.userId,
                    issuedByType: actor.actorType,
                    snapshot: snapshot as any,
                    totalAmount: grandTotal,
                },
            });
        } catch (err: any) {
            if (err.code === "P2002") {
                const raced = await db.proformaInvoice.findUnique({ where: { orderId } });
                if (raced) return raced;
            }
            throw err;
        }
    },

    async getBankTransferDetails(orderId: string, actor: { userId: string; sellerId?: string }) {
        const order = await db.order.findUnique({
            where: { id: orderId },
            select: { id: true, displayId: true, customerId: true, sellerId: true, totalAmount: true, finalAmount: true, payments: { where: { status: "PAID" }, select: { amount: true } } },
        });
        if (!order) throw new Error("Order not found");
        assertActorCanAccessOrder(order, actor);
        const bank = await loadSellerBankDetails(order.sellerId);
        if (!bank) throw new Error("Bank details not found");
        const total = Number(order.finalAmount ?? order.totalAmount);
        const paid = order.payments.reduce((s, p) => s + Number(p.amount), 0);
        const advancePercent = await getAdvancePercent();
        const advanceDue = paid > 0 ? 0 : parseFloat(((total * advancePercent) / 100).toFixed(2));
        return {
            bank,
            reference: order.displayId ?? order.id,
            total,
            paid,
            advancePercent,
            advanceDue,
            balanceDue: Math.max(0, parseFloat((total - paid).toFixed(2))),
        };
    },

    async getInvoiceForOrder(orderId: string, actor: { userId: string; sellerId?: string }) {
        const invoice = await db.invoice.findUnique({ where: { orderId } });
        if (!invoice) throw new Error("Invoice not found");
        assertActorCanAccessOrder({ customerId: invoice.buyerId, sellerId: invoice.sellerId }, actor);
        return invoice;
    },

    async getPurchaseOrderForOrder(orderId: string, actor: { userId: string; sellerId?: string }) {
        const po = await db.purchaseOrder.findUnique({ where: { orderId } });
        if (!po) throw new Error("Purchase order not found");
        assertActorCanAccessOrder({ customerId: po.buyerId, sellerId: po.sellerId }, actor);
        return po;
    },

    async getQuotationForOrder(orderId: string, actor: { userId: string; sellerId?: string }) {
        const quotation = await db.quotation.findUnique({ where: { orderId } });
        if (!quotation) throw new Error("Quotation not found");
        assertActorCanAccessOrder({ customerId: quotation.buyerId, sellerId: quotation.sellerId }, actor);
        return quotation;
    },

    async getProformaInvoiceForOrder(orderId: string, actor: { userId: string; sellerId?: string }) {
        const pi = await db.proformaInvoice.findUnique({ where: { orderId } });
        if (!pi) throw new Error("Proforma invoice not found");
        assertActorCanAccessOrder({ customerId: pi.buyerId, sellerId: pi.sellerId }, actor);
        return pi;
    },

    async renderInvoicePdf(orderId: string, actor: { userId: string; sellerId?: string }): Promise<Buffer> {
        const invoice = await invoicingService.getInvoiceForOrder(orderId, actor);
        const snapshot = invoice.snapshot as unknown as InvoiceSnapshot;
        return getOrRenderPdf("invoice", invoice.id, () =>
            renderToBuffer(asPdfDocument(React.createElement(InvoiceDocument, { snapshot }))));
    },

    async renderPurchaseOrderPdf(orderId: string, actor: { userId: string; sellerId?: string }): Promise<Buffer> {
        const po = await invoicingService.getPurchaseOrderForOrder(orderId, actor);
        const snapshot = po.snapshot as unknown as PurchaseOrderSnapshot;
        return getOrRenderPdf("purchase-order", po.id, () =>
            renderToBuffer(asPdfDocument(React.createElement(PurchaseOrderDocument, { snapshot }))));
    },

    async renderQuotationPdf(orderId: string, actor: { userId: string; sellerId?: string }): Promise<Buffer> {
        const quotation = await invoicingService.getQuotationForOrder(orderId, actor);
        const snapshot = quotation.snapshot as unknown as QuotationSnapshot;
        return getOrRenderPdf("quotation", quotation.id, () =>
            renderToBuffer(asPdfDocument(React.createElement(QuotationDocument, { snapshot }))));
    },

    async renderProformaInvoicePdf(orderId: string, actor: { userId: string; sellerId?: string }): Promise<Buffer> {
        const pi = await invoicingService.getProformaInvoiceForOrder(orderId, actor);
        const snapshot = pi.snapshot as unknown as ProformaInvoiceSnapshot;
        return getOrRenderPdf("proforma-invoice", pi.id, () =>
            renderToBuffer(asPdfDocument(React.createElement(ProformaInvoiceDocument, { snapshot }))));
    },

    async getInvoiceAdmin(invoiceId: string) {
        const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
        if (!invoice) throw new Error("Invoice not found");
        return invoice;
    },

    async getPurchaseOrderAdmin(poId: string) {
        const po = await db.purchaseOrder.findUnique({ where: { id: poId } });
        if (!po) throw new Error("Purchase order not found");
        return po;
    },

    async getQuotationAdmin(quotationId: string) {
        const quotation = await db.quotation.findUnique({ where: { id: quotationId } });
        if (!quotation) throw new Error("Quotation not found");
        return quotation;
    },

    async getProformaInvoiceAdmin(piId: string) {
        const pi = await db.proformaInvoice.findUnique({ where: { id: piId } });
        if (!pi) throw new Error("Proforma invoice not found");
        return pi;
    },

    async renderInvoicePdfAdmin(invoiceId: string): Promise<Buffer> {
        const invoice = await invoicingService.getInvoiceAdmin(invoiceId);
        const snapshot = invoice.snapshot as unknown as InvoiceSnapshot;
        return getOrRenderPdf("invoice", invoice.id, () =>
            renderToBuffer(asPdfDocument(React.createElement(InvoiceDocument, { snapshot }))));
    },

    async renderPurchaseOrderPdfAdmin(poId: string): Promise<Buffer> {
        const po = await invoicingService.getPurchaseOrderAdmin(poId);
        const snapshot = po.snapshot as unknown as PurchaseOrderSnapshot;
        return getOrRenderPdf("purchase-order", po.id, () =>
            renderToBuffer(asPdfDocument(React.createElement(PurchaseOrderDocument, { snapshot }))));
    },

    async renderQuotationPdfAdmin(quotationId: string): Promise<Buffer> {
        const quotation = await invoicingService.getQuotationAdmin(quotationId);
        const snapshot = quotation.snapshot as unknown as QuotationSnapshot;
        return getOrRenderPdf("quotation", quotation.id, () =>
            renderToBuffer(asPdfDocument(React.createElement(QuotationDocument, { snapshot }))));
    },

    async renderProformaInvoicePdfAdmin(piId: string): Promise<Buffer> {
        const pi = await invoicingService.getProformaInvoiceAdmin(piId);
        const snapshot = pi.snapshot as unknown as ProformaInvoiceSnapshot;
        return getOrRenderPdf("proforma-invoice", pi.id, () =>
            renderToBuffer(asPdfDocument(React.createElement(ProformaInvoiceDocument, { snapshot }))));
    },

    async listInvoicesAdmin(filters: { sellerId?: string; page?: number; limit?: number }) {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const where = filters.sellerId ? { sellerId: filters.sellerId } : {};
        const [data, total] = await Promise.all([
            db.invoice.findMany({
                where,
                select: {
                    id: true, invoiceNumber: true, orderId: true, sellerId: true, buyerId: true,
                    totalAmount: true, taxAmount: true, isProvisional: true, issuedByType: true, createdAt: true,
                    seller: { select: { name: true, businessName: true } },
                    buyer: { select: { name: true, email: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.invoice.count({ where }),
        ]);
        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
    },

    async listPurchaseOrdersAdmin(filters: { sellerId?: string; page?: number; limit?: number }) {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const where = filters.sellerId ? { sellerId: filters.sellerId } : {};
        const [data, total] = await Promise.all([
            db.purchaseOrder.findMany({
                where,
                select: {
                    id: true, poNumber: true, orderId: true, sellerId: true, buyerId: true,
                    totalAmount: true, issuedByType: true, createdAt: true,
                    seller: { select: { name: true, businessName: true } },
                    buyer: { select: { name: true, email: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.purchaseOrder.count({ where }),
        ]);
        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
    },

    async listQuotationsAdmin(filters: { sellerId?: string; page?: number; limit?: number }) {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const where = filters.sellerId ? { sellerId: filters.sellerId } : {};
        const [data, total] = await Promise.all([
            db.quotation.findMany({
                where,
                select: {
                    id: true, quotationNumber: true, orderId: true, sellerId: true, buyerId: true,
                    totalAmount: true, issuedByType: true, createdAt: true,
                    seller: { select: { name: true, businessName: true } },
                    buyer: { select: { name: true, email: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.quotation.count({ where }),
        ]);
        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
    },

    async listProformaInvoicesAdmin(filters: { sellerId?: string; page?: number; limit?: number }) {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const where = filters.sellerId ? { sellerId: filters.sellerId } : {};
        const [data, total] = await Promise.all([
            db.proformaInvoice.findMany({
                where,
                select: {
                    id: true, piNumber: true, orderId: true, sellerId: true, buyerId: true,
                    totalAmount: true, issuedByType: true, createdAt: true,
                    seller: { select: { name: true, businessName: true } },
                    buyer: { select: { name: true, email: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.proformaInvoice.count({ where }),
        ]);
        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
    },
};
import { db } from "../../db/index";
import { generateDisplayId } from "../../lib/uid/uid.generator";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import * as React from "react";
import { InvoiceDocument } from "../../lib/pdf/templates/invoice.template";
import { PurchaseOrderDocument } from "../../lib/pdf/templates/purchase-order.template";
import type {
    BillingDocumentLineItem,
    BillingDocumentParty,
    InvoiceSnapshot,
    PurchaseOrderSnapshot,
} from "./invoicing.types";

const ASSUMED_GST_RATE = 18;

const NON_CONFIRMED_ORDER_STATUSES = new Set([
    "PENDING",
    "NEGOTIATING",
    "PENDING_ASSIGNMENT",
    "CANCELLED",
    "UNFULFILLABLE",
]);

function asPdfDocument(element: React.ReactElement): React.ReactElement<DocumentProps> {
    return element as React.ReactElement<DocumentProps>;
}

async function loadOrderForBillingDocument(orderId: string) {
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

function buildLineItems(order: Awaited<ReturnType<typeof loadOrderForBillingDocument>>): BillingDocumentLineItem[] {
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

function buildSellerParty(order: Awaited<ReturnType<typeof loadOrderForBillingDocument>>): BillingDocumentParty {
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

function buildBuyerParty(order: Awaited<ReturnType<typeof loadOrderForBillingDocument>>): BillingDocumentParty {
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
    async generateInvoice(orderId: string, actor: { userId: string; sellerId?: string; actorType: "buyer" | "seller" }) {
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
        actor: { userId: string; sellerId?: string; actorType: "buyer" | "seller" },
    ) {
        const order = await loadOrderForBillingDocument(orderId);
        assertActorCanAccessOrder(order, actor);

        const existing = await db.purchaseOrder.findUnique({ where: { orderId } });
        if (existing) return existing;

        if (NON_CONFIRMED_ORDER_STATUSES.has(order.status)) {
            throw new Error("Cannot generate purchase order: order has not been confirmed yet");
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

    async renderInvoicePdf(orderId: string, actor: { userId: string; sellerId?: string }): Promise<Buffer> {
        const invoice = await invoicingService.getInvoiceForOrder(orderId, actor);
        const snapshot = invoice.snapshot as unknown as InvoiceSnapshot;
        return renderToBuffer(asPdfDocument(React.createElement(InvoiceDocument, { snapshot })));
    },

    async renderPurchaseOrderPdf(orderId: string, actor: { userId: string; sellerId?: string }): Promise<Buffer> {
        const po = await invoicingService.getPurchaseOrderForOrder(orderId, actor);
        const snapshot = po.snapshot as unknown as PurchaseOrderSnapshot;
        return renderToBuffer(asPdfDocument(React.createElement(PurchaseOrderDocument, { snapshot })));
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

    async renderInvoicePdfAdmin(invoiceId: string): Promise<Buffer> {
        const invoice = await invoicingService.getInvoiceAdmin(invoiceId);
        const snapshot = invoice.snapshot as unknown as InvoiceSnapshot;
        return renderToBuffer(asPdfDocument(React.createElement(InvoiceDocument, { snapshot })));
    },

    async renderPurchaseOrderPdfAdmin(poId: string): Promise<Buffer> {
        const po = await invoicingService.getPurchaseOrderAdmin(poId);
        const snapshot = po.snapshot as unknown as PurchaseOrderSnapshot;
        return renderToBuffer(asPdfDocument(React.createElement(PurchaseOrderDocument, { snapshot })));
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
};
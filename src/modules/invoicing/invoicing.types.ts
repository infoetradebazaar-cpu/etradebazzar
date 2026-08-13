export interface BillingDocumentLineItem {
    productName: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
}

export interface BillingDocumentParty {
    name: string;
    email: string;
    phone: string;
    address: {
        street: string;
        city: string;
        state: string;
        pincode: string;
    };
    gstin?: string | null;
}

export interface InvoiceSnapshot {
    invoiceNumber: string;
    orderId: string;
    orderDisplayId: string | null;
    issuedAt: string;
    seller: BillingDocumentParty;
    buyer: BillingDocumentParty;
    items: BillingDocumentLineItem[];
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    taxRate: number;
    grandTotal: number;
    isProvisional: boolean;
    provisionalReasons: string[];
}

export interface PurchaseOrderSnapshot {
    poNumber: string;
    orderId: string;
    orderDisplayId: string | null;
    issuedAt: string;
    orderPlacedAt: string;
    seller: BillingDocumentParty;
    buyer: BillingDocumentParty;
    items: BillingDocumentLineItem[];
    subtotal: number;
    discountAmount: number;
    grandTotal: number;
    shippingAddress: {
        receiverName: string;
        phone: string;
        street: string;
        city: string;
        state: string;
        pincode: string;
    } | null;
}

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

export interface BillingBankDetails {
    accountHolderName: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    gatewaySurchargePercent: number;
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
    bankDetails?: BillingBankDetails | null;
}

export interface QuotationSnapshot {
    quotationNumber: string;
    orderId: string;
    orderDisplayId: string | null;
    issuedAt: string;
    seller: BillingDocumentParty;
    buyer: BillingDocumentParty;
    items: BillingDocumentLineItem[];
    subtotal: number;
    discountAmount: number;
    grandTotal: number;
    disclaimerText: string;
    terms?: string[];
    bankDetails?: BillingBankDetails | null;
}

export interface ProformaInvoiceSnapshot {
    piNumber: string;
    orderId: string;
    orderDisplayId: string | null;
    issuedAt: string;
    seller: BillingDocumentParty;
    buyer: BillingDocumentParty;
    items: BillingDocumentLineItem[];
    subtotal: number;
    discountAmount: number;
    grandTotal: number;
    paymentNote: string;
    bankDetails?: BillingBankDetails | null;
    amountPaid?: number;
    balanceDue?: number;
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
    bankDetails?: BillingBankDetails | null;
}

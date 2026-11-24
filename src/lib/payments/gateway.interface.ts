export interface CreateOrderInput {
    amount: number; // in rupees/dollars 
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
}

export interface GatewayOrder {
    gatewayOrderId: string;
    amount: number;
    currency: string;
    receipt: string;
    raw: any;
}

export interface VerifyInput {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
}

export interface RefundInput {
    gatewayPaymentId: string;
    amount: number; // in rupees/dollars
    notes?: Record<string, string>;
}

export interface GatewayRefund {
    refundId: string;
    amount: number;
    raw: any;
}

export interface WebhookResult {
    event: string;
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    refundId?: string;
    amount?: number;
    status: "captured" | "failed" | "refunded" | "unknown";
}

export interface PaymentGateway {
    createOrder(data: CreateOrderInput): Promise<GatewayOrder>;
    verifyPayment(data: VerifyInput): Promise<boolean>;
    initiateRefund(data: RefundInput): Promise<GatewayRefund>;
    handleWebhook(payload: Buffer | string, signature: string): Promise<WebhookResult>;
    getPublicKey(): string;
}
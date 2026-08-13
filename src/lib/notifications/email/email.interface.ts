export interface SendEmailInput {
    to: string | string[];
    subject: string;
    template: EmailTemplate;
    data: Record<string, any>;
    html?: string;
}

export interface EmailResult {
    messageId: string;
    to: string | string[];
}

export type EmailTemplate =
    | "seller-approved"
    | "seller-rejected"
    | "product-approved"
    | "product-rejected"
    | "order-placed"
    | "order-confirmed"
    | "order-cancelled"
    | "shipment-updated"
    | "account-locked"
    | "negotiation-nudge"
    | "manual-negotiation-started"
    | "rbac-disagreement-alert"
    | "low-stock"
    | "payout-initiated"
    | "payout-paid"
    | "payout-failed"
    | "kyc-verified"
    | "kyc-rejected"
    | "team-invite"
    | "return-requested"
    | "return-approved"
    | "return-rejected";

export interface EmailProvider {
    send(input: SendEmailInput): Promise<EmailResult>;
}
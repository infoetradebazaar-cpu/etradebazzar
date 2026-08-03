export interface SendEmailInput {
    to: string | string[];
    subject: string;
    template: EmailTemplate;
    data: Record<string, any>;
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
    | "shipment-updated";

export interface EmailProvider {
    send(input: SendEmailInput): Promise<EmailResult>;
}
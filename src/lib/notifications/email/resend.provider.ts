import { config } from "../../../../config/config";
import { EmailProvider, EmailResult, SendEmailInput } from "./email.interface";
import { Resend } from 'resend';
import { SellerApprovedEmail } from "./templates/seller-approved";
import { SellerRejectedEmail } from "./templates/seller-rejected";
import { ProductApprovedEmail } from "./templates/product-approved";
import { ProductRejectedEmail } from "./templates/product-rejected";
import { OrderPlacedEmail } from "./templates/order-placed";
import { OrderConfirmedEmail } from "./templates/order-confirmed";
import { OrderCancelledEmail } from "./templates/order-cancelled";
import { ShipmentUpdatedEmail } from "./templates/shipment-updated";
import { render } from "@react-email/render";


const Subject: Record<string, string> = {
    "seller-approved": "Your seller account has been approved 🎉",
    "seller-rejected": "Update on your seller application",
    "product-approved": "Your product has been approved ✓",
    "product-rejected": "Your product needs attention",
    "order-placed": "Order placed successfully 🛒",
    "order-confirmed": "Your order has been confirmed ✓",
    "order-cancelled": "Your order has been cancelled",
    "shipment-updated": "Shipment update for your order 📦",
}


export class ResendProvider implements EmailProvider {
    private client: Resend;

    constructor() {
        this.client = new Resend(config.resendApiToken);
    }

    getTemplate(template: string, data: Record<string, any>): Promise<string> {
        switch (template) {
            case "seller-approved":
                return render(SellerApprovedEmail(data as any));
            case "seller-rejected":
                return render(SellerRejectedEmail(data as any));
            case "product-approved":
                return render(ProductApprovedEmail(data as any));
            case "product-rejected":
                return render(ProductRejectedEmail(data as any));
            case "order-placed":
                return render(OrderPlacedEmail(data as any));
            case "order-confirmed":
                return render(OrderConfirmedEmail(data as any));
            case "order-cancelled":
                return render(OrderCancelledEmail(data as any));
            case "shipment-updated":
                return render(ShipmentUpdatedEmail(data as any));
            default:
                throw new Error(`Unknown email template: ${template}`);
        }
    }
    async send(input: SendEmailInput): Promise<EmailResult> {
        const html = this.getTemplate(input.template, input.data);

        const { data, error } = await this.client.emails.send({
            from: config.companyEmail,
            to: Array.isArray(input.to) ? input.to : [input.to],
            subject: input.subject ?? Subject[input.template],
            react: html,
        });

        if (error) throw new Error(`Resend error: ${error.message}`);

        return {
            messageId: data!.id,
            to: input.to,
        };
    }
}
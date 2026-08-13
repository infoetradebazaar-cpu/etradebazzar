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
import { AccountLockedEmail } from "./templates/account-locked";
import { NegotiationNudgeEmail } from "./templates/negotiation-nudge";
import { ManualNegotiationStartedEmail } from "./templates/manual-negotiation-started";
import { RbacDisagreementAlertEmail } from "./templates/rbac-disagreement-alert";
import { LowStockEmail } from "./templates/low-stock";
import { PayoutInitiatedEmail } from "./templates/payout-initiated";
import { PayoutPaidEmail } from "./templates/payout-paid";
import { PayoutFailedEmail } from "./templates/payout-failed";
import { KycVerifiedEmail } from "./templates/kyc-verified";
import { KycRejectedEmail } from "./templates/kyc-rejected";
import { TeamInviteEmail } from "./templates/team-invite";
import { ReturnRequestedEmail } from "./templates/return-requested";
import { ReturnApprovedEmail } from "./templates/return-approved";
import { ReturnRejectedEmail } from "./templates/return-rejected";
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
    "account-locked": "Your account was temporarily locked",
    "negotiation-nudge": "Still interested? Talk directly with the seller",
    "manual-negotiation-started": "New negotiation request from a buyer",
    "rbac-disagreement-alert": "🚨 Platform RBAC dual-run check disagreement",
    "low-stock": "Low stock alert ⚠️",
    "payout-initiated": "Payout initiated",
    "payout-paid": "Payout successful ✓",
    "payout-failed": "Payout failed",
    "kyc-verified": "KYC verified ✓",
    "kyc-rejected": "KYC needs attention",
    "team-invite": "You've been invited to join a team",
    "return-requested": "Return request received",
    "return-approved": "Your return has been approved",
    "return-rejected": "Update on your return request",
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
            case "account-locked":
                return render(AccountLockedEmail(data as any));
            case "negotiation-nudge":
                return render(NegotiationNudgeEmail(data as any));
            case "manual-negotiation-started":
                return render(ManualNegotiationStartedEmail(data as any));
            case "rbac-disagreement-alert":
                return render(RbacDisagreementAlertEmail(data as any));
            case "low-stock":
                return render(LowStockEmail(data as any));
            case "payout-initiated":
                return render(PayoutInitiatedEmail(data as any));
            case "payout-paid":
                return render(PayoutPaidEmail(data as any));
            case "payout-failed":
                return render(PayoutFailedEmail(data as any));
            case "kyc-verified":
                return render(KycVerifiedEmail(data as any));
            case "kyc-rejected":
                return render(KycRejectedEmail(data as any));
            case "team-invite":
                return render(TeamInviteEmail(data as any));
            case "return-requested":
                return render(ReturnRequestedEmail(data as any));
            case "return-approved":
                return render(ReturnApprovedEmail(data as any));
            case "return-rejected":
                return render(ReturnRejectedEmail(data as any));
            default:
                throw new Error(`Unknown email template: ${template}`);
        }
    }
    async send(input: SendEmailInput): Promise<EmailResult> {
        const html = input.html ?? await this.getTemplate(input.template, input.data);

        const { data, error } = await this.client.emails.send({
            from: config.companyEmail,
            to: Array.isArray(input.to) ? input.to : [input.to],
            subject: input.subject ?? Subject[input.template],
            ...(input.html ? { html } : { react: html as any }),
        });

        if (error) throw new Error(`Resend error: ${error.message}`);

        return {
            messageId: data!.id,
            to: input.to,
        };
    }
}
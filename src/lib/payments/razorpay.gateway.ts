import Razorpay from "razorpay";
import crypto from "crypto"

import { config } from "../../../config/config";

import { CreateOrderInput, GatewayOrder, GatewayRefund, PaymentGateway, RefundInput, VerifyInput, WebhookResult } from "./gateway.interface";

function timingSafeEqualStr(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export class RazorpayInstance implements PaymentGateway {
    private client: Razorpay;

    constructor() {
        this.client = new Razorpay({
            key_id: config.razorpayKeyId,
            key_secret: config.razorpayKeySecret,
        });
    }

    getPublicKey(): string {
        return config.razorpayKeyId;
    }
    async createOrder(data: CreateOrderInput): Promise<GatewayOrder> {
        const order = await this.client.orders.create({
            amount: Math.round(data.amount * 100), //convert to paise
            currency: data.currency,
            receipt: data.receipt,
            notes: data.notes
        })

        return {
            gatewayOrderId: order.id,
            amount: data.amount,
            currency: data.currency,
            receipt: data.receipt,
            raw: order,
        };
    }
    async verifyPayment(data: VerifyInput): Promise<boolean> {
        const body = `${data.gatewayOrderId}|${data.gatewayPaymentId}`;
        const expected = crypto
            .createHmac("sha256", config.razorpayKeySecret)
            .update(body)
            .digest("hex");
        return timingSafeEqualStr(expected, data.signature);
    }

    async initiateRefund(data: RefundInput): Promise<GatewayRefund> {
        const refund = await this.client.payments.refund(data.gatewayPaymentId, {
            amount: Math.round(data.amount * 100),
            notes: data.notes,
        });

        return {
            refundId: refund.id,
            amount: data.amount,
            raw: refund,
        };
    }
    async handleWebhook(payload: Buffer | string, signature: string): Promise<WebhookResult> {
        const rawBody = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;

        const expected = crypto
            .createHmac("sha256", config.razorpayWebhookSecret)
            .update(rawBody)
            .digest("hex");

        if (!timingSafeEqualStr(expected, signature)) {
            throw new Error("Invalid webhook signature");
        }

        const parsed = JSON.parse(rawBody);

        const event = parsed.event as string;
        const paymentEntity = parsed.payload?.payment?.entity;
        const refundEntity = parsed.payload?.refund?.entity;

        switch (event) {
            case "payment.captured":
                return {
                    event,
                    gatewayOrderId: paymentEntity?.order_id,
                    gatewayPaymentId: paymentEntity?.id,
                    amount: paymentEntity?.amount / 100,
                    status: "captured",
                };

            case "payment.failed":
                return {
                    event,
                    gatewayOrderId: paymentEntity?.order_id,
                    gatewayPaymentId: paymentEntity?.id,
                    status: "failed",
                };

            case "refund.processed":
                return {
                    event,
                    gatewayPaymentId: refundEntity?.payment_id,
                    refundId: refundEntity?.id,
                    amount: refundEntity?.amount / 100,
                    status: "refunded",
                };

            default:
                return { event, status: "unknown" };
        }
    }
}


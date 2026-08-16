import { z } from "zod";

export const verifyPaymentSchema = z.object({
    body: z.object({
        orderId: z.string(),
        razorpayOrderId: z.string(),
        razorpayPaymentId: z.string(),
        razorpaySignature: z.string(),
    }),
});

export const orderPaymentParamSchema = z.object({
    params: z.object({
        orderId: z.string(),
    }),
});

export const shipmentPaymentParamSchema = z.object({
    params: z.object({
        shipmentId: z.string(),
    }),
});

export const recordManualPaymentSchema = z.object({
    params: z.object({
        orderId: z.string(),
    }),
    body: z.object({
        type: z.enum(["ADVANCE", "FINAL"]),
        amount: z.number().positive(),
        note: z.string().max(500).optional(),
    }),
});

export const setOnlinePaymentsEnabledSchema = z.object({
    body: z.object({
        enabled: z.boolean(),
    }),
});
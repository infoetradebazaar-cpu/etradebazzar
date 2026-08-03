import { z } from "zod";

export const addCartItemSchema = z.object({
    body: z.object({
        productId: z.string(),
        skuId: z.string().optional(),
        quantity: z.number().int().positive(),
    }),
});

export const updateCartItemSchema = z.object({
    params: z.object({ itemId: z.string() }),
    body: z.object({ quantity: z.number().int().positive() }),
});

export const cartItemParamSchema = z.object({ params: z.object({ itemId: z.string() }) });

export const checkoutSchema = z.object({
    body: z.object({
        idempotencyKey: z.string().uuid("idempotencyKey must be a valid UUID"),
        addressId: z.string().optional(),
        newAddress: z.object({
            receiverName: z.string().min(2),
            phone: z.string(),
            street: z.string().min(5),
            city: z.string().min(2),
            state: z.string().min(2),
            pincode: z.string().regex(/^\d{6}$/),
            latitude: z.number().optional(),
            longitude: z.number().optional(),
        }).optional(),
        couponCode: z.string().optional(),
        paymentMethod: z.enum(["ONLINE", "COD"]).optional(),
    }),
});
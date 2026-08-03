import { z } from "zod";

export const addWishlistItemSchema = z.object({
    body: z.object({
        productId: z.string(),
        skuId: z.string().optional(),
    }),
});

export const removeWishlistItemSchema = z.object({
    params: z.object({ productId: z.string() }),
    query: z.object({ skuId: z.string().optional() }).optional(),
});

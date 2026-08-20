import { z } from "zod";

export const productImageParamSchema = z.object({
    params: z.object({
        productId: z.string(),
    }),
});

export const uploadImageSchema = z.object({
    params: z.object({
        productId: z.string(),
    }),
    body: z.object({
        skuId: z.string().optional(),
    }),
});

export const deleteImageSchema = z.object({
    params: z.object({
        productId: z.string(),
        imageId: z.string(),
    }),
});

export const reorderImagesSchema = z.object({
    params: z.object({
        productId: z.string(),
    }),
    body: z.object({
        orderedIds: z.array(z.string()).min(1),
    }),
});
import { z } from "zod";

export const designParamSchema = z.object({
    params: z.object({ designId: z.string() }),
});

export const createDesignSchema = z.object({
    body: z.object({
        productId: z.string(),
        skuId: z.string().optional(),
        name: z.string().min(1).max(120).optional(),
        customizationState: z.record(z.string(), z.unknown()),
    }),
});

export const updateDesignSchema = z.object({
    params: z.object({ designId: z.string() }),
    body: z.object({
        name: z.string().min(1).max(120).optional(),
        customizationState: z.record(z.string(), z.unknown()).optional(),
    }),
});

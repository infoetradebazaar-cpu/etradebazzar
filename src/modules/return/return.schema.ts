import { z } from "zod";

export const createReturnSchema = z.object({
    body: z.object({
        orderId: z.string(),
        reason: z.string().min(10),
        imageAssetIds: z.array(z.string()).max(6).optional(),
    }),
});

export const returnParamSchema = z.object({
    params: z.object({
        returnId: z.string(),
    }),
});

export const reviewReturnSchema = z.object({
    params: z.object({
        returnId: z.string(),
    }),
    body: z.object({
        note: z.string().optional(),
    }),
});

export const rejectReturnSchema = z.object({
    params: z.object({
        returnId: z.string(),
    }),
    body: z.object({
        note: z.string().min(5),
    }),
});
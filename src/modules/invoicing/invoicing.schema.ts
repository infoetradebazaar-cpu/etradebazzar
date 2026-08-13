import { z } from "zod";

export const orderIdParamSchema = z.object({
    params: z.object({ orderId: z.string() }),
});

export const listBillingDocumentsSchema = z.object({
    query: z.object({
        sellerId: z.string().optional(),
        page: z.string().optional(),
        limit: z.string().optional(),
    }),
});

export const listMyBillingDocumentsSchema = z.object({
    query: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
    }),
});

export const invoiceIdParamSchema = z.object({
    params: z.object({ invoiceId: z.string() }),
});

export const poIdParamSchema = z.object({
    params: z.object({ poId: z.string() }),
});

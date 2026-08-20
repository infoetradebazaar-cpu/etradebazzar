import { z } from "zod";

const attributesSchema = z
    .string()
    .max(2000)
    .optional()
    .transform((raw, ctx) => {
        if (!raw) return undefined;
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "attributes must be valid JSON" });
            return z.NEVER;
        }
        const result = z.record(z.string().max(100), z.array(z.string().max(200)).max(50)).safeParse(parsed);
        if (!result.success) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "attributes must be a map of name -> string[]" });
            return z.NEVER;
        }
        return result.data;
    });

export const searchProductsSchema = z.object({
    query: z.object({
        q: z.string().min(1).max(200).optional(),
        categoryId: z.string().optional(),
        minPrice: z.string().regex(/^\d+(\.\d+)?$/, "Invalid minPrice").optional(),
        maxPrice: z.string().regex(/^\d+(\.\d+)?$/, "Invalid maxPrice").optional(),
        sellerId: z.string().optional(),
        sort: z.enum(["relevance", "price_asc", "price_desc", "newest"]).optional(),
        attributes: attributesSchema,
        page: z.string().regex(/^\d+$/, "Invalid page").optional(),
        limit: z.string().regex(/^\d+$/, "Invalid limit").optional(),
    }),
});

export const facetsQuerySchema = z.object({
    query: z.object({
        q: z.string().min(1).max(200).optional(),
        categoryId: z.string().optional(),
        minPrice: z.string().regex(/^\d+(\.\d+)?$/, "Invalid minPrice").optional(),
        maxPrice: z.string().regex(/^\d+(\.\d+)?$/, "Invalid maxPrice").optional(),
        sellerId: z.string().optional(),
        attributes: attributesSchema,
    }),
});

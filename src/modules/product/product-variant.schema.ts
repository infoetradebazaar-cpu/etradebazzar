import { z } from "zod";

export const createVariantSchema = z.object({
    params: z.object({ productId: z.string() }),
    body: z.object({
        name: z.string().min(1).max(50),
        values: z.array(z.string().min(1).max(100)).min(1),
    }),
});

export const addVariantValuesSchema = z.object({
    params: z.object({ productId: z.string(), optionId: z.string() }),
    body: z.object({
        values: z.array(z.string().min(1).max(100)).min(1),
    }),
});

export const variantParamSchema = z.object({
    params: z.object({ productId: z.string(), optionId: z.string() }),
});

export const variantValueParamSchema = z.object({
    params: z.object({
        productId: z.string(),
        optionId: z.string(),
        valueId: z.string(),
    }),
});

export const createSKUSchema = z.object({
    params: z.object({ productId: z.string() }),
    body: z.object({
        sku: z.string().min(1).max(100),
        price: z.number().positive(),
        stock: z.number().int().min(0),
        minQuantity: z.number().int().min(1).optional(),
        options: z.record(z.string(), z.string()),
    }),
});

export const updateSKUSchema = z.object({
    params: z.object({ productId: z.string(), skuId: z.string() }),
    body: z.object({
        price: z.number().positive().optional(),
        stock: z.number().int().min(0).optional(),
        minQuantity: z.number().int().min(1).optional(),
    }),
});

export const skuParamSchema = z.object({
    params: z.object({ productId: z.string(), skuId: z.string() }),
});

export const createPriceTierSchema = z.object({
    params: z.object({ productId: z.string(), skuId: z.string() }),
    body: z.object({
        minQty: z.number().int().min(2),
        maxQty: z.number().int().positive().optional(),
        price: z.number().positive(),
        hiddenFloorPrice: z.number().positive().optional(),
    }).refine((data) => data.maxQty === undefined || data.maxQty > data.minQty, {
        message: "maxQty must be greater than minQty",
        path: ["maxQty"],
    }),
});

export const updatePriceTierSchema = z.object({
    params: z.object({ productId: z.string(), skuId: z.string(), tierId: z.string() }),
    body: z.object({
        minQty: z.number().int().min(2).optional(),
        maxQty: z.number().int().positive().nullable().optional(),
        price: z.number().positive().optional(),
        hiddenFloorPrice: z.number().positive().nullable().optional(),
    }).refine(
        (data) =>
            data.minQty === undefined ||
            data.maxQty === undefined ||
            data.maxQty === null ||
            data.maxQty > data.minQty,
        { message: "maxQty must be greater than minQty", path: ["maxQty"] },
    ),
});

export const priceTierParamSchema = z.object({
    params: z.object({ productId: z.string(), skuId: z.string(), tierId: z.string() }),
});
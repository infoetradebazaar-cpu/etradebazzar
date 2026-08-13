import { z } from "zod";

const OPTION_TYPES = ["TEXT", "NUMBER", "COLOR", "SELECT", "IMAGE_UPLOAD"] as const;

export const productParamSchema = z.object({
    params: z.object({ productId: z.string() }),
});

export const groupParamSchema = z.object({
    params: z.object({ productId: z.string(), groupId: z.string() }),
});

export const optionParamSchema = z.object({
    params: z.object({ productId: z.string(), groupId: z.string(), optionId: z.string() }),
});

export const createGroupSchema = z.object({
    params: z.object({ productId: z.string() }),
    body: z.object({
        name: z.string().min(1).max(80),
        required: z.boolean().optional(),
        sortOrder: z.number().int().min(0).optional(),
    }),
});

export const updateGroupSchema = z.object({
    params: z.object({ productId: z.string(), groupId: z.string() }),
    body: z.object({
        name: z.string().min(1).max(80).optional(),
        required: z.boolean().optional(),
        sortOrder: z.number().int().min(0).optional(),
    }),
});

export const createOptionSchema = z.object({
    params: z.object({ productId: z.string(), groupId: z.string() }),
    body: z.object({
        label: z.string().min(1).max(80),
        type: z.enum(OPTION_TYPES),
        priceDelta: z.number().min(0).optional(),
        sortOrder: z.number().int().min(0).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }),
});

export const updateOptionSchema = z.object({
    params: z.object({ productId: z.string(), groupId: z.string(), optionId: z.string() }),
    body: z.object({
        label: z.string().min(1).max(80).optional(),
        type: z.enum(OPTION_TYPES).optional(),
        priceDelta: z.number().min(0).optional(),
        sortOrder: z.number().int().min(0).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    }),
});

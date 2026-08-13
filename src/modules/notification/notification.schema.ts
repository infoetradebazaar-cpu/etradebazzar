import { z } from "zod";

const categoryEnum = z.enum([
    "ORDER",
    "SHIPMENT",
    "PAYOUT",
    "NEGOTIATION",
    "PROMOTION",
    "SECURITY",
]);

export const updatePreferencesSchema = z.object({
    body: z.object({
        preferences: z
            .array(
                z.object({
                    category: categoryEnum,
                    enabled: z.boolean(),
                }),
            )
            .min(1)
            .max(20),
    }),
});

export const markAsReadSchema = z.object({
    body: z.object({
        ids: z.array(z.string()).min(1).max(100),
    }),
});

export const getNotificationsSchema = z.object({
    query: z.object({
        page: z.string().regex(/^\d+$/, "Invalid page").optional(),
        limit: z.string().regex(/^\d+$/, "Invalid limit").optional(),
    }),
});
import { z } from "zod";

export const notificationTypeParamSchema = z.object({
    params: z.object({ type: z.string() }),
});

export const upsertTemplateSchema = z.object({
    params: z.object({ type: z.string() }),
    body: z.object({
        subject: z.string().min(1).max(200),
        bodyHtml: z.string().min(1).max(20000),
    }),
});

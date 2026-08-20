import { z } from "zod";

export const setupTwoFactorSchema = z.object({
    body: z.object({
        method: z.enum(["totp", "email"]),
        currentToken: z.string().min(6).max(11).optional(),
    }),
});

export const verifyTwoFactorSetupSchema = z.object({
    body: z.object({
        method: z.enum(["totp", "email"]),
        token: z.string().length(6),
    }),
});

export const verifyTwoFactorSchema = z.object({
    body: z.object({ token: z.string().min(6).max(11) }),
});

export const requestTwoFactorEmailCodeSchema = z.object({
    body: z.object({ purpose: z.enum(["reverify", "disable"]) }),
});

export const sessionParamSchema = z.object({
    params: z.object({ sessionId: z.string() }),
});
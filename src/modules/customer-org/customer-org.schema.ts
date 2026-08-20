import { z } from "zod";

export const registerOrgAccountSchema = z.object({
    body: z.object({
        name: z.string().min(2).max(100),
        email: z.string().email(),
        password: z.string().min(8),
        orgName: z.string().min(2).max(80),
        legalEntityName: z.string().min(2).max(120),
        gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "Invalid GSTIN format"),
        pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN format"),
        businessType: z.string().min(2).max(60),
        industry: z.string().min(2).max(60).optional(),
    }),
});

export const updateOrgBusinessDetailsSchema = z.object({
    body: z.object({
        tradeName: z.string().max(120).optional(),
        businessType: z.string().max(60).optional(),
        industry: z.string().max(60).optional(),
        yearEstablished: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
        employees: z.string().max(30).optional(),
        annualTurnover: z.string().max(30).optional(),
        website: z.string().url().max(200).optional().or(z.literal("")),
        registeredEmail: z.string().email().optional(),
    }),
});

export const createOrgSchema = z.object({
    body: z.object({
        name: z.string().min(2).max(80),
    }),
});

export const updateOrgSchema = z.object({
    body: z.object({
        name: z.string().min(2).max(80),
    }),
});

export const createOrgRoleSchema = z.object({
    body: z.object({
        name: z.string().min(2).max(30),
        permissions: z.array(z.string()).optional(),
    }),
});

export const updateOrgRoleSchema = z.object({
    params: z.object({ roleId: z.string() }),
    body: z.object({
        name: z.string().min(2).max(30),
    }),
});

export const orgRoleParamSchema = z.object({
    params: z.object({ roleId: z.string() }),
});

export const updateOrgRolePermissionsSchema = z.object({
    params: z.object({ roleId: z.string() }),
    body: z.object({
        permissions: z.array(z.string()),
    }),
});

export const inviteOrgMemberSchema = z.object({
    body: z.object({
        email: z.string().email(),
        roleId: z.string(),
    }),
});

export const orgInviteParamSchema = z.object({
    params: z.object({ inviteId: z.string() }),
});

export const resendOrgInviteSchema = z.object({
    body: z.object({ inviteId: z.string() }),
});

export const acceptOrgInviteSchema = z.object({
    body: z.object({
        token: z.string(),
        name: z.string().min(2),
        password: z.string().min(8),
    }),
});

export const orgMemberParamSchema = z.object({
    params: z.object({ memberId: z.string() }),
});

export const updateOrgMemberRoleSchema = z.object({
    params: z.object({ memberId: z.string() }),
    body: z.object({ roleId: z.string() }),
});

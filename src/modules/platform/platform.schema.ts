import { z } from "zod";

export const createPlatformMemberSchema = z.object({
  body: z.object({
    email: z.string().email(),
    roleId: z.string(),
  }),
});

export const updatePlatformMemberSchema = z.object({
  params: z.object({
    memberId: z.string(),
  }),
  body: z.object({
    roleId: z.string(),
  }),
});

export const platformMemberParamSchema = z.object({
  params: z.object({
    memberId: z.string(),
  }),
});

export const createPlatformRoleSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(50),
    description: z.string().optional(),
  }),
});

export const updatePlatformRoleSchema = z.object({
  params: z.object({
    roleId: z.string(),
  }),
  body: z.object({
    name: z.string().min(2).max(50).optional(),
    description: z.string().optional(),
  }),
});

export const platformRoleParamSchema = z.object({
  params: z.object({
    roleId: z.string(),
  }),
});

export const updatePlatformRolePermissionsSchema = z.object({
  params: z.object({
    roleId: z.string(),
  }),
  body: z.object({
    permissionKeys: z.array(z.string()),
  }),
});

export const getAuditLogsSchema = z.object({
  query: z.object({
    sellerId: z.string().optional(),
    actorId: z.string().optional(),
    action: z.string().optional(),
    page: z.string().regex(/^\d+$/, "Invalid page").optional(),
    limit: z.string().regex(/^\d+$/, "Invalid limit").optional(),
  }),
});
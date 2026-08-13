import { z } from "zod";

const detectedFileTypeEnum = z.enum([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "model/gltf-binary", "model/gltf+json",
]);

export const createProductSchema = z.object({
  body: z.object({
    shopId: z.string().optional(),
    name: z.string().min(2).max(200),
    description: z.string().optional(),
    specification: z.string().max(50000).optional(),
    price: z.number().positive().optional(),
    compareAtPrice: z.number().positive().optional(),
    sku: z.string().optional(),
    stock: z.number().int().min(0).default(0),
    lowStockThreshold: z.number().int().min(0).optional(),
    categoryId: z.string(),
    weightGrams: z.number().int().positive().optional(),
    length: z.number().positive().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    isDigital: z.boolean().default(false),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    negotiationThresholdQty: z.number().int().min(1).optional(),
    customizationEnabled: z.boolean().optional(),
    customizationAcceptedFormats: z.array(detectedFileTypeEnum).max(20).optional(),
  }),
});

export const updateProductSchema = z.object({
  params: z.object({ productId: z.string() }),
  body: z.object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().optional(),
    specification: z.string().max(50000).optional(),
    price: z.number().positive().optional(),
    compareAtPrice: z.number().positive().optional(),
    sku: z.string().optional(),
    stock: z.number().int().min(0).optional(),
    categoryId: z.string().optional(),
    weightGrams: z.number().int().positive().optional(),
    length: z.number().positive().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    isDigital: z.boolean().optional(),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    negotiationThresholdQty: z.number().int().min(1).nullable().optional(),
    customizationEnabled: z.boolean().optional(),
    customizationAcceptedFormats: z.array(detectedFileTypeEnum).max(20).optional(),
  }),
});

export const productParamSchema = z.object({
  params: z.object({ productId: z.string() }),
});

export const reviewProductSchema = z.object({
  params: z.object({ productId: z.string() }),
  body: z.object({
    note: z.string().optional(),
    commissionRate: z.number().min(0).max(100),
  }),
});

export const rejectProductSchema = z.object({
  params: z.object({ productId: z.string() }),
  body: z.object({ reason: z.string().min(5) }),
});

export const submitForReviewSchema = z.object({
  params: z.object({ productId: z.string() }),
});

export const listProductsSchema = z.object({
  query: z.object({
    shopId: z.string().optional(),
    status: z.string().optional(),
    search: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const bulkProductActionSchema = z.object({
  body: z.object({
    productIds: z.array(z.string()).min(1),
    action: z.enum(["change_status", "assign_shop", "delete"]),
    status: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]).optional(),
    shopId: z.string().optional(),
  }),
});

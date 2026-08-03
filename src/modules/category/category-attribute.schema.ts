import { z } from "zod";

const attributeTypeEnum = z.enum(["TEXT", "NUMBER", "ENUM", "BOOLEAN"]);
const attributeOptionStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED", "MERGED"]);

export const categoryAttributeInputSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z][a-z0-9_]*$/, "key must be snake_case, starting with a letter"),
    label: z.string().min(1).max(100),
    type: attributeTypeEnum,
    required: z.boolean().default(false),
    isVariant: z.boolean().default(false),
    options: z.array(z.string().min(1).max(100)).default([]),
    unit: z.string().max(20).optional(),
    sortOrder: z.number().int().default(0),
  })
  .superRefine((data, ctx) => {
    if (data.type === "ENUM" && data.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "options is required when type is ENUM",
        path: ["options"],
      });
    }
    if (data.type !== "ENUM" && data.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "options is only allowed when type is ENUM",
        path: ["options"],
      });
    }
  });

export type CategoryAttributeInput = z.infer<typeof categoryAttributeInputSchema>;

export const createCategoryAttributeSchema = z.object({
  params: z.object({ categoryId: z.string() }),
  body: categoryAttributeInputSchema,
});

export const updateCategoryAttributeSchema = z.object({
  params: z.object({ categoryId: z.string(), attributeId: z.string() }),
  body: z.object({
    label: z.string().min(1).max(100).optional(),
    type: attributeTypeEnum.optional(),
    required: z.boolean().optional(),
    isVariant: z.boolean().optional(),
    unit: z.string().max(20).optional(),
    sortOrder: z.number().int().optional(),
  }),
});

export const categoryAttributeParamSchema = z.object({
  params: z.object({ categoryId: z.string(), attributeId: z.string() }),
});

export const listCategoryAttributesSchema = z.object({
  params: z.object({ categoryId: z.string() }),
});

// --- Attribute options (variant values, e.g. "Color" -> "Navy") ---

export const listAttributeOptionsSchema = z.object({
  params: z.object({ categoryId: z.string(), attributeId: z.string() }),
  query: z.object({
    status: attributeOptionStatusEnum.optional(),
  }),
});

export const createAttributeOptionSchema = z.object({
  params: z.object({ categoryId: z.string(), attributeId: z.string() }),
  body: z.object({
    value: z.string().min(1).max(100),
    label: z.string().min(1).max(100).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
});

export const updateAttributeOptionSchema = z.object({
  params: z.object({ categoryId: z.string(), attributeId: z.string(), optionId: z.string() }),
  body: z.object({
    value: z.string().min(1).max(100).optional(),
    label: z.string().min(1).max(100).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
});

export const attributeOptionParamSchema = z.object({
  params: z.object({ categoryId: z.string(), attributeId: z.string(), optionId: z.string() }),
});

export const reviewAttributeOptionSchema = z.object({
  params: z.object({ categoryId: z.string(), attributeId: z.string(), optionId: z.string() }),
  body: z.object({
    reviewNote: z.string().max(500).optional(),
  }),
});

export const mergeAttributeOptionSchema = z.object({
  params: z.object({ categoryId: z.string(), attributeId: z.string(), optionId: z.string() }),
  body: z.object({
    targetOptionId: z.string(),
  }),
});

export const listPendingAttributeOptionsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),
});

import { db } from "../../db/index";
import { AttributeOptionStatus, Prisma } from "../../../prisma/generated/client";

async function getOwnedAttribute(categoryId: string, attributeId: string) {
  const attribute = await db.categoryAttribute.findFirst({
    where: { id: attributeId, categoryId },
  });
  if (!attribute) throw new Error("Attribute not found");
  return attribute;
}

async function getOwnedOption(categoryId: string, attributeId: string, optionId: string) {
  const option = await db.categoryAttributeOption.findFirst({
    where: { id: optionId, categoryAttributeId: attributeId, categoryAttribute: { categoryId } },
  });
  if (!option) throw new Error("Option not found");
  return option;
}

async function findVariantOptionIdsForAttribute(categoryId: string, attributeLabel: string) {
  const rows = await db.variantOption.findMany({
    where: {
      name: { equals: attributeLabel, mode: "insensitive" },
      product: { categoryId },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export const categoryAttributeService = {
  async createAttribute(
    categoryId: string,
    data: {
      key: string;
      label: string;
      type: "TEXT" | "NUMBER" | "ENUM" | "BOOLEAN";
      required: boolean;
      isVariant: boolean;
      options: string[];
      unit?: string;
      sortOrder: number;
    },
  ) {
    const category = await db.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new Error("Category not found");

    const existing = await db.categoryAttribute.findUnique({
      where: { categoryId_key: { categoryId, key: data.key } },
    });
    if (existing) throw new Error("Attribute key already exists for this category");

    return db.categoryAttribute.create({
      data: {
        categoryId,
        key: data.key,
        label: data.label,
        type: data.type,
        required: data.required,
        isVariant: data.isVariant,
        unit: data.unit,
        sortOrder: data.sortOrder,
        options: {
          create: data.options.map((value) => ({ value, status: "APPROVED" as const })),
        },
      },
      include: { options: true },
    });
  },

  async updateAttribute(
    categoryId: string,
    attributeId: string,
    data: Partial<{
      label: string;
      type: "TEXT" | "NUMBER" | "ENUM" | "BOOLEAN";
      required: boolean;
      isVariant: boolean;
      unit: string;
      sortOrder: number;
    }>,
  ) {
    await getOwnedAttribute(categoryId, attributeId);

    return db.categoryAttribute.update({
      where: { id: attributeId },
      data,
    });
  },

  async deleteAttribute(categoryId: string, attributeId: string) {
    await getOwnedAttribute(categoryId, attributeId);
    await db.categoryAttribute.delete({ where: { id: attributeId } });
  },

  async listAttributes(categoryId: string) {
    const category = await db.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new Error("Category not found");

    return db.categoryAttribute.findMany({
      where: { categoryId },
      include: { options: { where: { status: "APPROVED" }, orderBy: { value: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
  },


  async listOptions(categoryId: string, attributeId: string, status?: AttributeOptionStatus) {
    await getOwnedAttribute(categoryId, attributeId);

    return db.categoryAttributeOption.findMany({
      where: { categoryAttributeId: attributeId, ...(status ? { status } : {}) },
      include: { createdBySeller: { select: { id: true, name: true, businessName: true } } },
      orderBy: { value: "asc" },
    });
  },

  async createOption(
    categoryId: string,
    attributeId: string,
    data: { value: string; label?: string; metadata?: Record<string, unknown> },
  ) {
    const attribute = await getOwnedAttribute(categoryId, attributeId);
    if (attribute.type !== "ENUM") throw new Error("Options can only be added to ENUM attributes");

    const existing = await db.categoryAttributeOption.findFirst({
      where: { categoryAttributeId: attributeId, value: { equals: data.value, mode: "insensitive" } },
    });
    if (existing) throw new Error("Option value already exists for this attribute");

    return db.categoryAttributeOption.create({
      data: {
        categoryAttributeId: attributeId,
        value: data.value,
        label: data.label,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
        status: "APPROVED",
      },
    });
  },

  async updateOption(
    categoryId: string,
    attributeId: string,
    optionId: string,
    data: Partial<{ value: string; label: string; metadata: Record<string, unknown> }>,
  ) {
    const option = await getOwnedOption(categoryId, attributeId, optionId);

    if (data.value && data.value.toLowerCase() !== option.value.toLowerCase()) {
      const clash = await db.categoryAttributeOption.findFirst({
        where: {
          categoryAttributeId: attributeId,
          value: { equals: data.value, mode: "insensitive" },
          NOT: { id: optionId },
        },
      });
      if (clash) throw new Error("Option value already exists for this attribute");
    }

    return db.categoryAttributeOption.update({
      where: { id: optionId },
      data: { ...data, metadata: data.metadata as Prisma.InputJsonValue | undefined },
    });
  },

  async approveOption(
    categoryId: string,
    attributeId: string,
    optionId: string,
    reviewerId: string,
    reviewNote?: string,
  ) {
    const option = await getOwnedOption(categoryId, attributeId, optionId);
    if (option.status === "MERGED") throw new Error("Cannot approve a merged option");

    return db.categoryAttributeOption.update({
      where: { id: optionId },
      data: { status: "APPROVED", reviewedBy: reviewerId, reviewNote: reviewNote ?? null, reviewedAt: new Date() },
    });
  },

  async rejectOption(
    categoryId: string,
    attributeId: string,
    optionId: string,
    reviewerId: string,
    reviewNote?: string,
  ) {
    const option = await getOwnedOption(categoryId, attributeId, optionId);
    if (option.status === "MERGED") throw new Error("Cannot reject a merged option");

    return db.categoryAttributeOption.update({
      where: { id: optionId },
      data: { status: "REJECTED", reviewedBy: reviewerId, reviewNote: reviewNote ?? null, reviewedAt: new Date() },
    });
  },

  async mergeOption(
    categoryId: string,
    attributeId: string,
    optionId: string,
    targetOptionId: string,
    reviewerId: string,
  ) {
    if (optionId === targetOptionId) throw new Error("Cannot merge an option into itself");

    const attribute = await getOwnedAttribute(categoryId, attributeId);
    const option = await getOwnedOption(categoryId, attributeId, optionId);
    const target = await db.categoryAttributeOption.findFirst({
      where: { id: targetOptionId, categoryAttributeId: attributeId },
    });
    if (!target) throw new Error("Target option not found");
    if (target.status === "MERGED") throw new Error("Cannot merge into an already-merged option");

    return db.$transaction(async (tx) => {
      const variantOptionIds = await findVariantOptionIdsForAttribute(categoryId, attribute.label);
      if (variantOptionIds.length) {
        await tx.variantOptionValue.updateMany({
          where: {
            optionId: { in: variantOptionIds },
            value: { equals: option.value, mode: "insensitive" },
          },
          data: { value: target.value },
        });
      }

      return tx.categoryAttributeOption.update({
        where: { id: optionId },
        data: {
          status: "MERGED",
          mergedIntoId: targetOptionId,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      });
    });
  },

  async deleteOption(categoryId: string, attributeId: string, optionId: string) {
    const attribute = await getOwnedAttribute(categoryId, attributeId);
    const option = await getOwnedOption(categoryId, attributeId, optionId);

    if (option.status === "APPROVED") {
      const variantOptionIds = await findVariantOptionIdsForAttribute(categoryId, attribute.label);
      const inUse = variantOptionIds.length
        ? await db.variantOptionValue.findFirst({
            where: { optionId: { in: variantOptionIds }, value: { equals: option.value, mode: "insensitive" } },
          })
        : null;
      if (inUse) throw new Error("Cannot delete an option that is in use  reject or merge instead");
    }

    await db.categoryAttributeOption.delete({ where: { id: optionId } });
  },

  async listPendingOptions(filters: { page?: number; limit?: number }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const [data, total] = await Promise.all([
      db.categoryAttributeOption.findMany({
        where: { status: "PENDING" },
        include: {
          categoryAttribute: { select: { id: true, label: true, key: true, categoryId: true } },
          createdBySeller: { select: { id: true, name: true, businessName: true } },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.categoryAttributeOption.count({ where: { status: "PENDING" } }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  },
};

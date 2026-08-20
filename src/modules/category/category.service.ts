import { db } from "../../db/index";
import type { CategoryAttributeInput } from "./category-attribute.schema";

const ATTRIBUTE_UNIQUE_CONSTRAINT = "key";

function isUniqueConstraintError(err: any, field: string): boolean {
  if (err?.code !== "P2002") return false;
  const target = err?.meta?.target;
  const fields = err?.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(target) && target.includes(field)) return true;
  if (typeof target === "string" && target.includes(field)) return true;
  if (Array.isArray(fields) && fields.includes(field)) return true;
  return false;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function toAttributeScalarData(attr: CategoryAttributeInput) {
  return {
    label: attr.label,
    type: attr.type,
    required: attr.required,
    isVariant: attr.isVariant,
    unit: attr.unit,
    sortOrder: attr.sortOrder,
  };
}

export const categoryService = {
  async createCategory(data: {
    name: string;
    description?: string;
    parentId?: string;
    attributes?: CategoryAttributeInput[];
  }) {
    const slug = generateSlug(data.name);

    const existing = await db.category.findUnique({ where: { slug } });
    if (existing) throw new Error("Category already exists");

    if (data.parentId) {
      const parent = await db.category.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) throw new Error("Parent category not found");
    }

    try {
      return await db.$transaction(async (tx) => {
        const category = await tx.category.create({
          data: {
            name: data.name,
            slug,
            description: data.description,
            parentId: data.parentId,
          },
        });

        if (data.attributes?.length) {
          for (const attr of data.attributes) {
            await tx.categoryAttribute.create({
              data: {
                categoryId: category.id,
                key: attr.key,
                ...toAttributeScalarData(attr),
                options: {
                  create: attr.options.map((value) => ({ value, status: "APPROVED" as const })),
                },
              },
            });
          }
        }

        return tx.category.findUniqueOrThrow({
          where: { id: category.id },
          include: { attributes: { orderBy: { sortOrder: "asc" } } },
        });
      });
    } catch (err: any) {
      if (isUniqueConstraintError(err, ATTRIBUTE_UNIQUE_CONSTRAINT)) {
        throw new Error("Duplicate attribute key in request");
      }
      throw err;
    }
  },

  async updateCategory(
    categoryId: string,
    data: {
      name?: string;
      description?: string;
      parentId?: string;
      attributes?: CategoryAttributeInput[];
    },
  ) {
    const category = await db.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) throw new Error("Category not found");

    // prevent circular ref
    if (data.parentId) {
      if (data.parentId === categoryId)
        throw new Error("Category cannot be its own parent");
      const parent = await db.category.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) throw new Error("Parent category not found");
    }

    const updateData: any = {
      name: data.name,
      description: data.description,
      parentId: data.parentId,
    };
    if (data.name) {
      updateData.slug = generateSlug(data.name);
    }

    try {
      return await db.$transaction(async (tx) => {
        await tx.category.update({ where: { id: categoryId }, data: updateData });

        if (data.attributes?.length) {
          for (const attr of data.attributes) {
            const attribute = await tx.categoryAttribute.upsert({
              where: { categoryId_key: { categoryId, key: attr.key } },
              create: {
                categoryId,
                key: attr.key,
                ...toAttributeScalarData(attr),
                options: {
                  create: attr.options.map((value) => ({ value, status: "APPROVED" as const })),
                },
              },
              update: toAttributeScalarData(attr),
            });
            for (const value of attr.options) {
              await tx.categoryAttributeOption.upsert({
                where: { categoryAttributeId_value: { categoryAttributeId: attribute.id, value } },
                create: { categoryAttributeId: attribute.id, value, status: "APPROVED" },
                update: { status: "APPROVED" },
              });
            }
          }
        }

        return tx.category.findUniqueOrThrow({
          where: { id: categoryId },
          include: { attributes: { orderBy: { sortOrder: "asc" } } },
        });
      });
    } catch (err: any) {
      if (isUniqueConstraintError(err, ATTRIBUTE_UNIQUE_CONSTRAINT)) {
        throw new Error("Duplicate attribute key in request");
      }
      throw err;
    }
  },

  async deleteCategory(categoryId: string) {
    const category = await db.category.findUnique({
      where: { id: categoryId },
      include: {
        _count: { select: { children: true, products: true } },
      },
    });
    if (!category) throw new Error("Category not found");
    if (category._count.children > 0)
      throw new Error("Category has subcategories  delete them first");
    if (category._count.products > 0)
      throw new Error("Category has products  reassign before deleting");

    return db.category.delete({ where: { id: categoryId } });
  },

  async listCategories(parentId?: string) {
    return db.category.findMany({
      where: { parentId: parentId ?? null },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        parentId: true,
        _count: { select: { children: true, products: true } },
      },
      orderBy: { name: "asc" },
    });
  },

  // full nested tree for category picker
  async getCategoryTree() {
    const all = await db.category.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        parentId: true,
      },
      orderBy: { name: "asc" },
    });

    return buildTree(all, null);
  },

  async getCategory(categoryId: string) {
    const category = await db.category.findUnique({
      where: { id: categoryId },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: { select: { id: true, name: true, slug: true } },
        _count: { select: { products: true } },
      },
    });
    if (!category) throw new Error("Category not found");
    return category;
  },
};

type FlatCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
};

type TreeCategory = FlatCategory & { children: TreeCategory[] };

function buildTree(
  items: FlatCategory[],
  parentId: string | null,
): TreeCategory[] {
  return items
    .filter((item) => item.parentId === parentId)
    .map((item) => ({
      ...item,
      children: buildTree(items, item.id),
    }));
}

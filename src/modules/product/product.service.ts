import { db } from "../../db/index";
import { logger } from "../../utils/logger";
import { notificationService } from "../notification/notification.service";
import { generateDisplayId } from "../../lib/uid/uid.generator";
import {
  withTenantScope,
  withOptionalTenantScope,
} from "../../middleware/tenant";
import { resolveImageUrls } from "./product-image.service";

const SKU_UNIQUE_CONSTRAINT = "products_sku_key";

function isUniqueConstraintError(err: any, constraintName: string): boolean {
  return err?.code === "P2002" && err?.meta?.target?.includes?.(constraintName);
}

async function validateProductAttributes(
  categoryId: string,
  attributes:
    | Record<string, string | number | boolean | null>
    | null
    | undefined,
): Promise<void> {
  const definitions = await db.categoryAttribute.findMany({
    where: { categoryId, isVariant: false },
  });
  if (!definitions.length) return;

  const values = attributes ?? {};
  const knownKeys = new Set(definitions.map((d) => d.key));

  for (const key of Object.keys(values)) {
    if (!knownKeys.has(key)) {
      throw new Error(`Unknown attribute "${key}" for this category`);
    }
  }

  for (const def of definitions) {
    const value = values[def.key];
    const isEmpty = value === undefined || value === null || value === "";

    if (def.required && isEmpty) {
      throw new Error(`Missing required attribute "${def.label}"`);
    }
    if (
      !isEmpty &&
      def.type === "ENUM" &&
      !def.options.includes(String(value))
    ) {
      throw new Error(`Invalid value for attribute "${def.label}"`);
    }
  }
}

export const productService = {
  async createProduct(
    sellerId: string,
    actorId: string,
    data: {
      shopId?: string;
      name: string;
      description?: string;
      price?: number;
      compareAtPrice?: number;
      sku?: string;
      stock?: number;
      lowStockThreshold?: number;
      categoryId: string;
      weightGrams?: number;
      length?: number;
      width?: number;
      height?: number;
      isDigital: boolean;
      attributes?: Record<string, string | number | boolean | null>;
    },
  ) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC not submitted");
    if (kyc.status !== "VERIFIED") throw new Error("KYC not verified");

    const category = await db.category.findUnique({
      where: { id: data.categoryId },
    });
    if (!category) throw new Error("Category not found");

    await validateProductAttributes(data.categoryId, data.attributes);

    const displayId = await generateDisplayId("product");

    try {
      return await withTenantScope(async (tx) => {
        if (data.shopId) {
          const shop = await tx.shop.findFirst({
            where: { id: data.shopId, sellerId },
          });
          if (!shop) throw new Error("Shop not found");
          if (shop.status !== "APPROVED") throw new Error("Shop not approved");
        }

        const product = await tx.product.create({
          data: {
            sellerId,
            shopId: data.shopId ?? null,
            categoryId: data.categoryId,
            displayId,
            name: data.name,
            description: data.description,
            price: data.price,
            compareAtPrice: data.compareAtPrice,
            sku: data.sku,
            stock: data.stock,
            lowStockThreshold: data.lowStockThreshold,
            weightGrams: data.weightGrams,
            length: data.length,
            width: data.width,
            height: data.height,
            isDigital: data.isDigital,
            attributes: data.attributes ?? undefined,
          },
        });

        await tx.auditLog.create({
          data: {
            sellerId,
            actorId,
            actorType: "seller",
            action: "PRODUCT_CREATED",
            entityType: "product",
            entityId: product.id,
            metadata: { name: data.name, shopId: data.shopId ?? null },
          },
        });

        return product;
      });
    } catch (err: any) {
      if (isUniqueConstraintError(err, SKU_UNIQUE_CONSTRAINT)) {
        throw new Error("SKU already exists");
      }
      throw err;
    }
  },

  async updateProduct(
    sellerId: string,
    actorId: string,
    productId: string,
    data: Partial<{
      name: string;
      description: string;
      price: number;
      compareAtPrice: number;
      sku: string;
      stock: number;
      categoryId: string;
      weightGrams: number;
      length: number;
      width: number;
      height: number;
      isDigital: boolean;
      attributes: Record<string, string | number | boolean | null>;
    }>,
  ) {
    if (data.categoryId) {
      const category = await db.category.findUnique({
        where: { id: data.categoryId },
      });
      if (!category) throw new Error("Category not found");
    }

    try {
      return await withTenantScope(async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: productId, sellerId },
        });
        if (!product) throw new Error("Product not found");
        if (product.status === "REJECTED")
          throw new Error("Cannot update rejected product");

        if (data.categoryId || data.attributes !== undefined) {
          const effectiveCategoryId = data.categoryId ?? product.categoryId;
          const effectiveAttributes =
            data.attributes !== undefined
              ? data.attributes
              : (product.attributes as Record<
                  string,
                  string | number | boolean | null
                > | null);
          await validateProductAttributes(
            effectiveCategoryId,
            effectiveAttributes,
          );
        }

        const updated = await tx.product.update({
          where: { id: productId },
          data,
        });

        await tx.auditLog.create({
          data: {
            sellerId,
            actorId,
            actorType: "seller",
            action: "PRODUCT_UPDATED",
            entityType: "product",
            entityId: productId,
            metadata: data as any,
          },
        });

        return updated;
      });
    } catch (err: any) {
      if (isUniqueConstraintError(err, SKU_UNIQUE_CONSTRAINT)) {
        throw new Error("SKU already exists");
      }
      throw err;
    }
  },

  async getProduct(sellerId: string, productId: string) {
    const product = await withTenantScope((tx) =>
      tx.product.findFirst({
        where: { id: productId, sellerId },
        include: {
          images: { orderBy: { order: "asc" } },
          skus: true,
          variants: { include: { values: true } },
          shop: { select: { id: true, name: true, slug: true } },
          category: { select: { id: true, name: true } },
        },
      }),
    );
    if (!product) throw new Error("Product not found");

    const seller = await db.seller.findUnique({
      where: { id: product.sellerId },
      select: { id: true, name: true, businessName: true },
    });

    const images = await resolveImageUrls(product.images);

    return {
      ...product,
      seller,
      images,
      status: product.status.toLowerCase(),
      price: product.price ? Number(product.price) : null,
      compareAtPrice: product.compareAtPrice
        ? Number(product.compareAtPrice)
        : null,
    };
  },

  async getProductById(productId: string) {
    const product = await withOptionalTenantScope((tx) =>
      tx.product.findUnique({
        where: { id: productId },
        include: {
          images: { orderBy: { order: "asc" } },
          skus: true,
          variants: { include: { values: true } },
          shop: {
            select: {
              id: true,
              name: true,
              slug: true,
              seller: { select: { id: true, name: true, businessName: true } },
            },
          },
          category: { select: { id: true, name: true } },
        },
      }),
    );
    if (!product) throw new Error("Product not found");

    const seller = await db.seller.findUnique({
      where: { id: product.sellerId },
      select: { id: true, name: true, businessName: true },
    });

    const images = await resolveImageUrls(product.images);

    return {
      ...product,
      seller,
      images,
      status: product.status.toLowerCase(),
      price: product.price ? Number(product.price) : null,
      compareAtPrice: product.compareAtPrice
        ? Number(product.compareAtPrice)
        : null,
    };
  },

  async listProducts(
    sellerId: string,
    filters: {
      shopId?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const where: any = { sellerId };
    if (filters.shopId) where.shopId = filters.shopId;
    if (filters.status) {
      const STATUS_MAP: Record<string, string> = {
        pending: "PENDING",
        approved: "APPROVED",
        rejected: "REJECTED",
        draft: "DRAFT",
        archived: "ARCHIVED",
      };
      where.status = STATUS_MAP[filters.status] ?? filters.status.toUpperCase();
    }
    if (filters.search)
      where.name = { contains: filters.search, mode: "insensitive" };

    const { data, total } = await withTenantScope(async (tx) => {
      const data = await tx.product.findMany({
        where,
        include: {
          images: { orderBy: { order: "asc" } },
          skus: true,
          shop: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
      const total = await tx.product.count({ where });
      return { data, total };
    });

    const withSignedImages = await Promise.all(
      data.map(async (p) => ({
        ...p,
        images: await resolveImageUrls(p.images),
      })),
    );

    const mapped = withSignedImages.map((p) => ({
      ...p,
      status: p.status.toLowerCase(),
      price: p.price ? Number(p.price) : null,
      compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
    }));

    return {
      data: mapped,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async approveProduct(productId: string, actorId: string, note?: string) {
    const { updated, product } = await withTenantScope(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new Error("Product not found");
      if (product.status !== "PENDING")
        throw new Error("Product is not pending");

      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          status: "APPROVED",
          reviewedBy: actorId,
          reviewNote: note ?? null,
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId: product.sellerId,
          actorId,
          actorType: "platform",
          action: "PRODUCT_APPROVED",
          entityType: "product",
          entityId: productId,
          metadata: { note },
        },
      });

      return { updated, product };
    });

    const [owner, seller] = await Promise.all([
      db.sellerMember.findFirst({
        where: { sellerId: product.sellerId, role: { name: "owner" } },
        select: { userId: true },
      }),
      db.seller.findUnique({
        where: { id: product.sellerId },
        select: { email: true, name: true },
      }),
    ]);

    if (owner && seller) {
      notificationService
        .productApproved({
          userId: owner.userId,
          email: seller.email,
          sellerName: seller.name,
          productName: product.name,
          note,
        })
        .catch(() => null);
    }

    return updated;
  },

  async rejectProduct(productId: string, actorId: string, reason: string) {
    const { updated, product } = await withTenantScope(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new Error("Product not found");
      if (product.status !== "PENDING")
        throw new Error("Product is not pending");

      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          status: "REJECTED",
          reviewedBy: actorId,
          reviewNote: reason,
          reviewedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId: product.sellerId,
          actorId,
          actorType: "platform",
          action: "PRODUCT_REJECTED",
          entityType: "product",
          entityId: productId,
          metadata: { reason },
        },
      });

      return { updated, product };
    });
    const [owner, seller] = await Promise.all([
      db.sellerMember.findFirst({
        where: { sellerId: product.sellerId, role: { name: "owner" } },
        select: { userId: true },
      }),
      db.seller.findUnique({
        where: { id: product.sellerId },
        select: { email: true, name: true },
      }),
    ]);

    if (owner && seller) {
      notificationService
        .productRejected({
          userId: owner.userId,
          email: seller.email,
          sellerName: seller.name,
          productName: product.name,
          reason,
        })
        .catch(() => null);
    }

    return updated;
  },

  async listPendingProducts() {
    const products = await withTenantScope((tx) =>
      tx.product.findMany({
        where: { status: "PENDING" },
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          status: true,
          createdAt: true,
          shop: {
            select: {
              id: true,
              name: true,
              seller: { select: { id: true, name: true, businessName: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
    );
    return products.map((p) => ({
      ...p,
      status: p.status.toLowerCase(),
      price: p.price ? Number(p.price) : null,
    }));
  },

  async listAllProducts(filters: {
    status?: string;
    search?: string;
    sellerId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const STATUS_MAP: Record<string, string> = {
      pending: "PENDING",
      approved: "APPROVED",
      rejected: "REJECTED",
      draft: "DRAFT",
      archived: "ARCHIVED",
    };

    const where: any = {};
    if (filters.status && filters.status !== "all") {
      where.status = STATUS_MAP[filters.status] ?? filters.status.toUpperCase();
    }
    if (filters.sellerId) {
      where.shop = { sellerId: filters.sellerId };
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { sku: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const { data, total } = await withTenantScope(async (tx) => {
      const data = await tx.product.findMany({
        where,
        select: {
          id: true,
          displayId: true,
          name: true,
          price: true,
          category: true,
          sku: true,
          status: true,
          createdAt: true,
          shop: {
            select: {
              id: true,
              name: true,
              seller: { select: { id: true, name: true, businessName: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
      const total = await tx.product.count({ where });
      return { data, total };
    });

    const mapped = data.map((p) => ({
      ...p,
      seller: p.shop?.seller ?? null,
      status: p.status.toLowerCase(),
      price: p.price ? Number(p.price) : null,
    }));

    return {
      data: mapped,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async deleteProduct(sellerId: string, actorId: string, productId: string) {
    return withTenantScope(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, sellerId },
      });
      if (!product) throw new Error("Product not found");
      if (product.status === "APPROVED")
        throw new Error("Cannot delete approved product");

      await tx.product.delete({ where: { id: productId } });

      await tx.auditLog.create({
        data: {
          sellerId,
          actorId,
          actorType: "seller",
          action: "PRODUCT_DELETED",
          entityType: "product",
          entityId: productId,
        },
      });
    });
  },
  async bulkAction(
    sellerId: string,
    actorId: string,
    data: {
      productIds: string[];
      action: "change_status" | "assign_shop" | "delete";
      status?: "PENDING" | "APPROVED" | "REJECTED";
      shopId?: string;
    },
  ) {
    return withTenantScope(async (tx) => {
      let success = 0,
        failed = 0;

      for (const productId of data.productIds) {
        try {
          const product = await tx.product.findFirst({
            where: { id: productId, sellerId },
          });
          if (!product) {
            failed++;
            continue;
          }

          if (data.action === "change_status" && data.status) {
            await tx.product.update({
              where: { id: productId },
              data: { status: data.status },
            });
          } else if (data.action === "assign_shop" && data.shopId) {
            const shop = await tx.shop.findFirst({
              where: { id: data.shopId, sellerId },
            });
            if (!shop) {
              failed++;
              continue;
            }
            await tx.product.update({
              where: { id: productId },
              data: { shopId: data.shopId },
            });
          } else if (data.action === "delete") {
            if (product.status === "APPROVED") {
              failed++;
              continue;
            }
            await tx.product.delete({ where: { id: productId } });
          } else {
            failed++;
            continue;
          }
          success++;
        } catch (err: any) {
          logger.error(
            { err: err.message, productId, action: data.action },
            "Bulk product action item failed",
          );
          failed++;
        }
      }

      await tx.auditLog.create({
        data: {
          sellerId,
          actorId,
          actorType: "seller",
          action: "PRODUCT_BULK_ACTION",
          entityType: "product",
          entityId: "bulk",
          metadata: { action: data.action, success, failed },
        },
      });

      return { success, failed };
    });
  },
  async exportProductsCsv(sellerId: string, shopId?: string) {
    return withTenantScope((tx) =>
      tx.product.findMany({
        where: { sellerId, ...(shopId && { shopId }) },
        select: {
          id: true,
          displayId: true,
          name: true,
          price: true,
          stock: true,
          status: true,
          sku: true,
          createdAt: true,
          shop: { select: { name: true } },
          category: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  },
};
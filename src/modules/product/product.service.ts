import { db } from "../../db/index";
import { logger } from "../../utils/logger";
import { notificationService } from "../notification/notification.service";
import { generateDisplayId } from "../../lib/uid/uid.generator";
import {
  withTenantScope,
  withOptionalTenantScope,
} from "../../middleware/tenant";
import { resolveImageUrls } from "./product-image.service";
import { syncProductSearchIndexInBackground } from "../../lib/search/product-search-document";
import { sanitizeSpecificationHtml } from "../../lib/sanitize/html-sanitizer";
import {
  findCategoryVariantAttribute,
  resolveVariantValues,
  dedupeCaseInsensitive,
  validateSkuOptions,
  validateTierRange,
  translateTierTriggerError,
} from "./product-variant.service";

const SKU_UNIQUE_CONSTRAINT = "sku";

function isUniqueConstraintError(err: any, field: string): boolean {
  if (err?.code !== "P2002") return false;
  const target = err?.meta?.target;
  const fields = err?.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(target) && target.includes(field)) return true;
  if (typeof target === "string" && target.includes(field)) return true;
  if (Array.isArray(fields) && fields.includes(field)) return true;
  return false;
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
    include: { options: true },
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
      !def.options.some(
        (opt) => opt.status === "APPROVED" && opt.value === String(value),
      )
    ) {
      throw new Error(`Invalid value for attribute "${def.label}"`);
    }
  }
}

type CreateProductInput = {
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
  negotiationThresholdQty?: number;
  customizationEnabled?: boolean;
  customizationAcceptedFormats?: string[];
  specification?: string;
};

async function reclaimAbandonedDraftSku(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  sellerId: string,
  sku: string,
): Promise<void> {
  const existing = await tx.product.findUnique({
    where: { sku },
    include: {
      _count: { select: { images: true, variants: true, skus: true } },
    },
  });
  if (!existing) return;
  if (existing.sellerId !== sellerId) return;
  if (existing.status !== "DRAFT") return;
  if (
    existing._count.images > 0 ||
    existing._count.variants > 0 ||
    existing._count.skus > 0
  ) {
    return;
  }

  await tx.product.delete({ where: { id: existing.id } });
}

export const productService = {
  async createProduct(
    sellerId: string,
    actorId: string,
    data: CreateProductInput,
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
        if (data.sku) {
          await reclaimAbandonedDraftSku(tx, sellerId, data.sku);
        }

        const product = await tx.product.create({
          data: {
            sellerId,
            categoryId: data.categoryId,
            displayId,
            name: data.name,
            description: data.description,
            specification: data.specification !== undefined
              ? sanitizeSpecificationHtml(data.specification)
              : undefined,
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
            negotiationThresholdQty: data.negotiationThresholdQty,
            customizationEnabled: data.customizationEnabled,
            customizationAcceptedFormats: data.customizationAcceptedFormats,
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
            metadata: { name: data.name },
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

  async createProductComplete(
    sellerId: string,
    actorId: string,
    data: {
      product: CreateProductInput;
      variants: { name: string; values: string[] }[];
      skus: {
        sku: string;
        price: number;
        stock: number;
        minQuantity?: number;
        options: Record<string, string>;
        priceTiers: {
          minQty: number;
          maxQty?: number;
          price: number;
          hiddenFloorPrice?: number;
        }[];
      }[];
    },
  ) {
    const kyc = await db.sellerKyc.findUnique({ where: { sellerId } });
    if (!kyc) throw new Error("KYC not submitted");
    if (kyc.status !== "VERIFIED") throw new Error("KYC not verified");

    const category = await db.category.findUnique({
      where: { id: data.product.categoryId },
    });
    if (!category) throw new Error("Category not found");

    await validateProductAttributes(data.product.categoryId, data.product.attributes);

    const displayId = await generateDisplayId("product");

    try {
      return await withTenantScope(async (tx) => {
        const product = await tx.product.create({
          data: {
            sellerId,
            categoryId: data.product.categoryId,
            displayId,
            name: data.product.name,
            description: data.product.description,
            specification: data.product.specification !== undefined
              ? sanitizeSpecificationHtml(data.product.specification)
              : undefined,
            price: data.product.price,
            compareAtPrice: data.product.compareAtPrice,
            sku: data.product.sku,
            stock: data.product.stock,
            lowStockThreshold: data.product.lowStockThreshold,
            weightGrams: data.product.weightGrams,
            length: data.product.length,
            width: data.product.width,
            height: data.product.height,
            isDigital: data.product.isDigital,
            attributes: data.product.attributes ?? undefined,
            negotiationThresholdQty: data.product.negotiationThresholdQty,
            customizationEnabled: data.product.customizationEnabled,
            customizationAcceptedFormats: data.product.customizationAcceptedFormats,
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
            metadata: { name: data.product.name },
          },
        });

        const variantsByName = new Map<string, Set<string>>();

        for (const variant of data.variants) {
          const categoryAttribute = await findCategoryVariantAttribute(
            product.categoryId,
            variant.name,
          );
          const values = dedupeCaseInsensitive(
            categoryAttribute
              ? await resolveVariantValues(categoryAttribute, sellerId, variant.values)
              : variant.values,
          );

          await tx.variantOption.create({
            data: {
              productId: product.id,
              name: variant.name,
              values: { create: values.map((value) => ({ value })) },
            },
          });

          variantsByName.set(variant.name, new Set(values));
        }

        const variantsForValidation = Array.from(variantsByName.entries()).map(
          ([name, values]) => ({
            name,
            values: Array.from(values).map((value) => ({ value })),
          }),
        );

        let skuCount = 0;
        for (const skuInput of data.skus) {
          await validateSkuOptions(variantsForValidation, skuInput.options);

          const createdSku = await tx.productSKU.create({
            data: {
              productId: product.id,
              sku: skuInput.sku,
              price: skuInput.price,
              stock: skuInput.stock,
              minQuantity: skuInput.minQuantity ?? 1,
              options: skuInput.options,
            },
          });
          skuCount += 1;

          const createdTiers: { id: string; minQty: number; maxQty: number | null }[] = [];
          for (const tier of skuInput.priceTiers) {
            validateTierRange(createdTiers, tier.minQty, tier.maxQty ?? null);
            try {
              const createdTier = await tx.skuPriceTier.create({
                data: {
                  skuId: createdSku.id,
                  minQty: tier.minQty,
                  maxQty: tier.maxQty,
                  price: tier.price,
                  hiddenFloorPrice: tier.hiddenFloorPrice,
                },
              });
              createdTiers.push({
                id: createdTier.id,
                minQty: createdTier.minQty,
                maxQty: createdTier.maxQty,
              });
            } catch (err: any) {
              if (err?.code === "P2002") {
                throw new Error(`A tier at minQty=${tier.minQty} already exists for this SKU`);
              }
              throw translateTierTriggerError(err);
            }
          }
        }

        if (skuCount > 0) {
          await tx.product.update({ where: { id: product.id }, data: { stock: 0 } });
        }

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
      negotiationThresholdQty: number | null;
      customizationEnabled: boolean;
      customizationAcceptedFormats: string[];
      specification: string;
    }>,
  ) {
    if (data.specification !== undefined) {
      data.specification = sanitizeSpecificationHtml(data.specification);
    }
    if (data.categoryId) {
      const category = await db.category.findUnique({
        where: { id: data.categoryId },
      });
      if (!category) throw new Error("Category not found");
    }

    try {
      const updated = await withTenantScope(async (tx) => {
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
      syncProductSearchIndexInBackground(productId);
      return updated;
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
          skus: {
            include: {
              priceTiers: {
                orderBy: { minQty: "asc" },
                select: { id: true, skuId: true, minQty: true, maxQty: true, price: true, createdAt: true, updatedAt: true },
              },
            },
          },
          variants: { include: { values: true } },
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
      status: product.status,
      price: product.price ? Number(product.price) : null,
      compareAtPrice: product.compareAtPrice
        ? Number(product.compareAtPrice)
        : null,
      skus: product.skus.map((s) => ({
        ...s,
        price: Number(s.price),
        priceTiers: (s.priceTiers ?? []).map((t) => ({
          ...t,
          price: Number(t.price),
        })),
      })),
    };
  },

  async getProductById(productId: string) {
    const product = await withOptionalTenantScope((tx) =>
      tx.product.findUnique({
        where: { id: productId },
        include: {
          images: { orderBy: { order: "asc" } },
          skus: {
            include: {
              priceTiers: {
                orderBy: { minQty: "asc" },
                select: { id: true, skuId: true, minQty: true, maxQty: true, price: true, createdAt: true, updatedAt: true },
              },
            },
          },
          variants: { include: { values: true } },
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
      status: product.status,
      price: product.price ? Number(product.price) : null,
      compareAtPrice: product.compareAtPrice
        ? Number(product.compareAtPrice)
        : null,
      skus: product.skus.map((s) => ({
        ...s,
        price: Number(s.price),
        priceTiers: (s.priceTiers ?? []).map((t) => ({
          ...t,
          price: Number(t.price),
        })),
      })),
    };
  },

  async listProducts(
    sellerId: string,
    filters: {
      status?: string;
      search?: string;
      category?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const where: any = { sellerId };
    if (filters.status) {
      const STATUS_MAP: Record<string, string> = {
        pending: "PENDING_APPROVAL",
        approved: "APPROVED",
        rejected: "REJECTED",
        draft: "DRAFT",
        archived: "ARCHIVED",
      };
      where.status = STATUS_MAP[filters.status] ?? filters.status.toUpperCase();
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { sku: { contains: filters.search, mode: "insensitive" } },
        { displayId: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    if (filters.category) {
      where.category = { name: { contains: filters.category, mode: "insensitive" } };
    }

    const { data, total, countsMap } = await withTenantScope(async (tx) => {
      const data = await tx.product.findMany({
        where,
        include: {
          images: { orderBy: { order: "asc" } },
          skus: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
      const total = await tx.product.count({ where });

      const statusCounts = await tx.product.groupBy({
        by: ["status"],
        where: { sellerId },
        _count: { status: true },
      });
      const countsMap: Record<string, number> = {};
      for (const sc of statusCounts) {
        countsMap[sc.status] = sc._count.status;
      }

      return { data, total, countsMap };
    });

    const withSignedImages = await Promise.all(
      data.map(async (p) => ({
        ...p,
        images: await resolveImageUrls(p.images),
      })),
    );

    const mapped = withSignedImages.map((p) => ({
      ...p,
      status: p.status,
      price: p.price ? Number(p.price) : null,
      compareAtPrice: p.compareAtPrice ? Number(p.compareAtPrice) : null,
    }));

    return {
      data: mapped,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1, statusCounts: countsMap },
    };
  },

  async submitForReview(sellerId: string, actorId: string, productId: string) {
    return withTenantScope(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: productId, sellerId } });
      if (!product) throw new Error("Product not found");
      if (product.status !== "DRAFT") {
        throw new Error("Only draft products can be submitted for review");
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: { status: "PENDING_APPROVAL" },
      });

      await tx.auditLog.create({
        data: {
          sellerId,
          actorId,
          actorType: "seller",
          action: "PRODUCT_SUBMITTED_FOR_REVIEW",
          entityType: "product",
          entityId: productId,
          metadata: {},
        },
      });

      return updated;
    });
  },

  async approveProduct(
    productId: string,
    actorId: string,
    commissionRate: number,
    note?: string,
  ) {
    const { updated, product } = await withTenantScope(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new Error("Product not found");
      if (product.status !== "PENDING_APPROVAL")
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

      const proposal = await tx.commissionProposal.create({
        data: {
          productId,
          proposedRate: commissionRate,
          proposedBy: actorId,
          proposedByType: "platform",
          round: 1,
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId: product.sellerId,
          actorId,
          actorType: "platform",
          action: "COMMISSION_PROPOSED",
          entityType: "commission_proposal",
          entityId: proposal.id,
          metadata: { productId, rate: commissionRate, round: 1 },
        },
      });

      return { updated, product };
    });

    syncProductSearchIndexInBackground(productId);

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
      if (product.status !== "PENDING_APPROVAL")
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

    syncProductSearchIndexInBackground(productId);

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
        where: { status: "PENDING_APPROVAL" },
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          status: true,
          createdAt: true,
          sellerId: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    );

    const sellerIds = [...new Set(products.map((p) => p.sellerId))];
    const sellers = await db.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, name: true, businessName: true },
    });
    const sellerMap = new Map(sellers.map((s) => [s.id, s]));

    return products.map((p) => ({
      ...p,
      seller: sellerMap.get(p.sellerId) ?? null,
      status: p.status,
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
      pending: "PENDING_APPROVAL",
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
      where.sellerId = filters.sellerId;
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
          sellerId: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
      const total = await tx.product.count({ where });
      return { data, total };
    });

    const sellerIds = [...new Set(data.map((p) => p.sellerId))];
    const sellers = await db.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, name: true, businessName: true },
    });
    const sellerMap = new Map(sellers.map((s) => [s.id, s]));

    const mapped = data.map((p) => ({
      ...p,
      seller: sellerMap.get(p.sellerId) ?? null,
      status: p.status,
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
      if (product.status === "APPROVED" || product.status === "LIVE")
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
      action: "change_status" | "delete";
      status?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
    },
  ) {
    const searchSyncCandidates: string[] = [];

    const result = await withTenantScope(async (tx) => {
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
            searchSyncCandidates.push(productId);
          } else if (data.action === "delete") {
            if (product.status === "APPROVED" || product.status === "LIVE") {
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

    for (const productId of searchSyncCandidates) {
      syncProductSearchIndexInBackground(productId);
    }

    return result;
  },
  async exportProductsCsv(sellerId: string) {
    return withTenantScope((tx) =>
      tx.product.findMany({
        where: { sellerId },
        select: {
          id: true,
          displayId: true,
          name: true,
          price: true,
          stock: true,
          status: true,
          sku: true,
          createdAt: true,
          category: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  },
};
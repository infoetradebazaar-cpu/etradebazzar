import { db } from "../../db/index";

const PRODUCT_SELECT = {
  id: true,
  name: true,
  price: true,
  stock: true,
  sellerId: true,
  images: { take: 1, orderBy: { order: "asc" as const } },
};

export const wishlistService = {
  async list(userId: string) {
    return db.wishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: PRODUCT_SELECT },
        sku: { select: { id: true, sku: true, price: true, stock: true, options: true } },
      },
    });
  },

  async addItem(userId: string, data: { productId: string; skuId?: string }) {
    const product = await db.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new Error("Product not found");

    if (data.skuId) {
      const sku = await db.productSKU.findUnique({ where: { id: data.skuId } });
      if (!sku || sku.productId !== data.productId) throw new Error("Product not found");
    }

    const existing = await db.wishlistItem.findFirst({
      where: { userId, productId: data.productId, skuId: data.skuId ?? null },
    });
    if (existing) return existing;

    return db.wishlistItem.create({
      data: { userId, productId: data.productId, skuId: data.skuId },
    });
  },

  async removeItem(userId: string, productId: string, skuId?: string) {
    const result = await db.wishlistItem.deleteMany({
      where: { userId, productId, skuId: skuId ?? null },
    });
    if (result.count === 0) throw new Error("Wishlist item not found");
    return { removed: true };
  },
};

import { db } from "../../db/index";
import type { Prisma } from "../../../prisma/generated/client";

export const storefrontService = {
    async getShopBySlug(slug: string) {
        const shop = await db.shop.findUnique({
            where: { slug },
            select: {
                id: true, displayId: true, name: true, slug: true, description: true,
                category: true, logo: true, banner: true, returnPolicy: true, status: true,
                sellerId: true,
            },
        });
        if (!shop || shop.status !== "APPROVED") throw new Error("Shop not found");
        const { sellerId, ...rest } = shop;
        const products = await db.product.count({ where: { sellerId, status: "LIVE" } });
        return { ...rest, _count: { products } };
    },

    async listShopProducts(
        slug: string,
        filters: { search?: string; categoryId?: string; page?: number; limit?: number }
    ) {
        const shop = await db.shop.findUnique({ where: { slug }, select: { sellerId: true, status: true } });
        if (!shop || shop.status !== "APPROVED") throw new Error("Shop not found");

        const page = filters.page ?? 1;
        const limit = Math.min(filters.limit ?? 20, 100);

        const where: Prisma.ProductWhereInput = { sellerId: shop.sellerId, status: "LIVE" };
        if (filters.categoryId) where.categoryId = filters.categoryId;
        if (filters.search) where.name = { contains: filters.search, mode: "insensitive" };

        const [rows, total] = await Promise.all([
            db.product.findMany({
                where,
                select: {
                    id: true, displayId: true, name: true, price: true, compareAtPrice: true,
                    stock: true, images: { take: 1, orderBy: { order: "asc" } },
                    category: { select: { id: true, name: true } },
                    skus: { select: { stock: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.product.count({ where }),
        ]);

        const data = rows.map(({ skus, ...product }) => ({
            ...product,
            stock: skus.length ? skus.reduce((sum, s) => sum + (s.stock ?? 0), 0) : product.stock,
        }));

        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
    },

    async getPublicProduct(productId: string) {
        const product = await db.product.findUnique({
            where: { id: productId },
            include: {
                images: { orderBy: { order: "asc" } },
                variants: { include: { values: true } },
                skus: true,
                category: { select: { id: true, name: true } },
            },
        });
        if (!product || (product.status !== "LIVE" && product.status !== "APPROVED")) throw new Error("Product not found");
        const seller = await db.seller.findUnique({
            where: { id: product.sellerId },
            select: { id: true, businessName: true },
        });
        return { ...product, seller };
    },
};
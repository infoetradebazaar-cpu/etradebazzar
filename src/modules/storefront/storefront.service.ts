import { db } from "../../db/index";

export const storefrontService = {
    async getShopBySlug(slug: string) {
        const shop = await db.shop.findUnique({
            where: { slug },
            select: {
                id: true, displayId: true, name: true, slug: true, description: true,
                category: true, logo: true, banner: true, returnPolicy: true, status: true,
                _count: { select: { products: { where: { status: "LIVE" } } } },
            },
        });
        if (!shop || shop.status !== "APPROVED") throw new Error("Shop not found");
        return shop;
    },

    async listShopProducts(
        slug: string,
        filters: { search?: string; categoryId?: string; page?: number; limit?: number }
    ) {
        const shop = await db.shop.findUnique({ where: { slug }, select: { id: true, status: true } });
        if (!shop || shop.status !== "APPROVED") throw new Error("Shop not found");

        const page = filters.page ?? 1;
        const limit = Math.min(filters.limit ?? 20, 100);

        const where: any = { shopId: shop.id, status: "LIVE" };
        if (filters.categoryId) where.categoryId = filters.categoryId;
        if (filters.search) where.name = { contains: filters.search, mode: "insensitive" };

        const [data, total] = await Promise.all([
            db.product.findMany({
                where,
                select: {
                    id: true, displayId: true, name: true, price: true, compareAtPrice: true,
                    stock: true, images: { take: 1, orderBy: { order: "asc" } },
                    category: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            db.product.count({ where }),
        ]);

        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
    },

    async getPublicProduct(productId: string) {
        const product = await db.product.findUnique({
            where: { id: productId },
            include: {
                images: { orderBy: { order: "asc" } },
                variants: { include: { values: true } },
                skus: true,
                shop: { select: { id: true, name: true, slug: true, logo: true } },
                category: { select: { id: true, name: true } },
            },
        });
        if (!product || product.status !== "LIVE") throw new Error("Product not found");
        return product;
    },
};
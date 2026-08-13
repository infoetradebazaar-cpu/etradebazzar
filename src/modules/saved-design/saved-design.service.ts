import { db } from "../../db/index";
import { Prisma } from "../../../prisma/generated/client";

export const savedDesignService = {
    async create(
        userId: string,
        data: { productId: string; skuId?: string; name?: string; customizationState: Record<string, unknown> },
    ) {
        const product = await db.product.findUnique({ where: { id: data.productId } });
        if (!product) throw new Error("Product not found");

        if (data.skuId) {
            const sku = await db.productSKU.findFirst({ where: { id: data.skuId, productId: data.productId } });
            if (!sku) throw new Error("SKU not found");
        }

        return db.savedDesign.create({
            data: {
                userId,
                productId: data.productId,
                skuId: data.skuId,
                name: data.name,
                customizationState: data.customizationState as Prisma.InputJsonValue,
            },
        });
    },

    async list(userId: string) {
        return db.savedDesign.findMany({
            where: { userId },
            select: {
                id: true, productId: true, skuId: true, name: true, createdAt: true, updatedAt: true,
                product: { select: { id: true, name: true, images: { take: 1, orderBy: { order: "asc" } } } },
            },
            orderBy: { updatedAt: "desc" },
        });
    },

    async get(userId: string, designId: string) {
        const design = await db.savedDesign.findFirst({ where: { id: designId, userId } });
        if (!design) throw new Error("Saved design not found");
        return design;
    },

    async update(
        userId: string,
        designId: string,
        data: { name?: string; customizationState?: Record<string, unknown> },
    ) {
        const design = await db.savedDesign.findFirst({ where: { id: designId, userId } });
        if (!design) throw new Error("Saved design not found");
        return db.savedDesign.update({
            where: { id: designId },
            data: {
                name: data.name,
                customizationState: data.customizationState as Prisma.InputJsonValue | undefined,
            },
        });
    },

    async delete(userId: string, designId: string) {
        const design = await db.savedDesign.findFirst({ where: { id: designId, userId } });
        if (!design) throw new Error("Saved design not found");

        await db.savedDesign.delete({ where: { id: designId } });
        return { deleted: true };
    },
};

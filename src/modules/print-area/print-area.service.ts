import { db } from "../../db/index";

export const printAreaService = {
    async setPrintArea(
        sellerId: string,
        productId: string,
        data: { widthCm: number; heightCm: number; safetyMarginCm?: number; bleedMarginCm?: number },
        skuId: string | null = null,
    ) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");
        if (skuId) {
            const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
            if (!sku) throw new Error("SKU not found");
        }

        return db.$transaction(async (tx) => {
            const existing = skuId
                ? await tx.printArea.findUnique({ where: { productId_skuId: { productId, skuId } } })
                : await tx.printArea.findFirst({ where: { productId, skuId: null } });

            if (existing) {
                return tx.printArea.update({
                    where: { id: existing.id },
                    data: {
                        widthCm: data.widthCm,
                        heightCm: data.heightCm,
                        safetyMarginCm: data.safetyMarginCm,
                        bleedMarginCm: data.bleedMarginCm,
                    },
                });
            }

            try {
                return await tx.printArea.create({
                    data: {
                        productId,
                        skuId,
                        widthCm: data.widthCm,
                        heightCm: data.heightCm,
                        safetyMarginCm: data.safetyMarginCm ?? 0.5,
                        bleedMarginCm: data.bleedMarginCm ?? 0.3,
                    },
                });
            } catch (err: any) {
                if (err.code === "P2002") {
                    throw new Error(
                        skuId
                            ? "A print area already exists for this variant - retry"
                            : "A print area already exists for this product - retry",
                    );
                }
                throw err;
            }
        });
    },

    async getPrintArea(productId: string, skuId: string | null = null) {
        const printArea = skuId
            ? await db.printArea.findUnique({ where: { productId_skuId: { productId, skuId } } })
            : await db.printArea.findFirst({ where: { productId, skuId: null } });
        if (!printArea) throw new Error("Print area not configured for this product");
        return printArea;
    },

    async deletePrintArea(sellerId: string, productId: string, skuId: string | null = null) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        const existing = skuId
            ? await db.printArea.findUnique({ where: { productId_skuId: { productId, skuId } } })
            : await db.printArea.findFirst({ where: { productId, skuId: null } });
        if (!existing) return { deleted: false };

        await db.printArea.delete({ where: { id: existing.id } });
        return { deleted: true };
    },
};
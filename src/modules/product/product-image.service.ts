import { db } from "../../db/index";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { generateProductImageKey, validateImageFile } from "../../lib/storage/storage.utils";

const MAX_IMAGES_PER_PRODUCT = 20;
export async function resolveImageUrls<T extends { key: string; url: string }>(
    images: T[],
): Promise<T[]> {
    if (images.length === 0) return images;
    const storage = StorageFactory.get();
    return Promise.all(
        images.map(async (img) => ({
            ...img,
            url: await storage.getSignedUrl({ key: img.key, expiresIn: 3600 }),
        })),
    );
}

export const productImageService = {
    async uploadImage(
        sellerId: string,
        productId: string,
        file: Express.Multer.File,
        skuId?: string | null,
    ) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        if (skuId) {
            const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
            if (!sku) throw new Error("SKU not found");
        }

        validateImageFile({ mimetype: file.mimetype, size: file.size });

        const count = await db.productImage.count({ where: { productId } });
        if (count >= MAX_IMAGES_PER_PRODUCT) {
            throw new Error(`Maximum ${MAX_IMAGES_PER_PRODUCT} images allowed per product`);
        }

        const key = generateProductImageKey(sellerId, productId, file.originalname);
        const storage = StorageFactory.get();

        const { url } = await storage.upload({
            key,
            buffer: file.buffer,
            mimeType: file.mimetype,
            size: file.size,
        });

        return db.productImage.create({
            data: { productId, skuId: skuId ?? null, url, key, order: count },
        });
    },

    async deleteImage(sellerId: string, productId: string, imageId: string) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        const image = await db.productImage.findFirst({ where: { id: imageId, productId } });
        if (!image) throw new Error("Image not found");

        const storage = StorageFactory.get();
        await storage.delete({ key: image.key });
        await db.productImage.delete({ where: { id: imageId } });

        const remaining = await db.productImage.findMany({
            where: { productId },
            orderBy: { order: "asc" },
        });

        await Promise.all(
            remaining.map((img, index) =>
                db.productImage.update({ where: { id: img.id }, data: { order: index } })
            )
        );
    },

    async reorderImages(sellerId: string, productId: string, orderedIds: string[]) {
        const product = await db.product.findFirst({ where: { id: productId, sellerId } });
        if (!product) throw new Error("Product not found");

        const images = await db.productImage.findMany({ where: { productId } });
        const imageIds = new Set(images.map((i) => i.id));

        for (const id of orderedIds) {
            if (!imageIds.has(id)) throw new Error(`Image ${id} not found for this product`);
        }

        await Promise.all(
            orderedIds.map((id, index) =>
                db.productImage.update({ where: { id }, data: { order: index } })
            )
        );

        return db.productImage.findMany({
            where: { productId },
            orderBy: { order: "asc" },
        });
    },

    async listImages(productId: string, skuId?: string) {
        const images = await db.productImage.findMany({
            where: skuId ? { productId, skuId } : { productId },
            orderBy: { order: "asc" },
        });
        return resolveImageUrls(images);
    }
};
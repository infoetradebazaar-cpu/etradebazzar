import { db } from "../../db/index";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { validateFileContent, type DetectedFileType } from "../../lib/storage/file-signature";
const ALLOWED_THUMBNAIL_TYPES: readonly DetectedFileType[] = ["image/jpeg", "image/png", "image/webp"];

function validateThumbnailFile(file: Express.Multer.File): DetectedFileType {
    try {
        return validateFileContent(file.buffer, ALLOWED_THUMBNAIL_TYPES);
    } catch {
        throw new Error("Invalid file type. Only JPEG, PNG, and WEBP thumbnails are allowed");
    }
}

export const templateService = {
    async createTemplate(
        sellerId: string,
        data: {
            productId: string;
            name: string;
            industry?: string;
            style?: string;
            canvasState: object;
        },
        thumbnailFile: Express.Multer.File
    ) {
        const product = await db.product.findFirst({ where: { id: data.productId, sellerId } });
        if (!product) throw new Error("Product not found");
        const contentType = validateThumbnailFile(thumbnailFile);

        const storage = StorageFactory.get();
        const upload = await storage.upload({
            key: `templates/${data.productId}/${Date.now()}-${thumbnailFile.originalname}`,
            buffer: thumbnailFile.buffer,
            mimeType: contentType,
            size: thumbnailFile.size,
        });

        return db.template.create({
            data: {
                productId: data.productId,
                sellerId,
                name: data.name,
                industry: data.industry,
                style: data.style,
                thumbnailUrl: upload.url,
                thumbnailKey: upload.key,
                canvasState: data.canvasState,
            },
        });
    },

    async updateTemplate(
        sellerId: string,
        templateId: string,
        data: Partial<{ name: string; industry: string; style: string; canvasState: object; isActive: boolean }>
    ) {
        const template = await db.template.findFirst({ where: { id: templateId, sellerId } });
        if (!template) throw new Error("Template not found");

        return db.template.update({ where: { id: templateId }, data });
    },

    async deleteTemplate(sellerId: string, templateId: string) {
        const template = await db.template.findFirst({ where: { id: templateId, sellerId } });
        if (!template) throw new Error("Template not found");

        const storage = StorageFactory.get();
        await storage.delete({ key: template.thumbnailKey }).catch(() => null);

        return db.template.delete({ where: { id: templateId } });
    },

    async listTemplatesForProduct(productId: string) {
        return db.template.findMany({
            where: { productId, isActive: true },
            orderBy: { createdAt: "desc" },
        });
    },

    async listSellerTemplates(sellerId: string) {
        return db.template.findMany({
            where: { sellerId },
            include: { product: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
        });
    },

    async getTemplate(templateId: string) {
        const template = await db.template.findFirst({ where: { id: templateId, isActive: true } });
        if (!template) throw new Error("Template not found");
        return template;
    },
};
import { db } from "../../db/index";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { detectFileSignature, isSpreadsheetContent, DetectedFileType } from "../../lib/storage/file-signature";
import { randomUUID } from "crypto";

const EXT_BY_TYPE: Record<DetectedFileType, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "model/gltf-binary": ".glb",
    "model/gltf+json": ".gltf",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-matroska": ".mkv",
};

// Spreadsheets carry no reliable magic bytes (xlsx is just a ZIP, csv is text)
// so they're verified by isSpreadsheetContent + declared type/original name.
const SPREADSHEET_TYPES: Record<string, string> = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "text/csv": ".csv",
};

const DEFAULT_ALLOWED_TYPES: readonly DetectedFileType[] = [
    "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
];

const ALLOWED_CATEGORIES = ["customer-uploads", "shop-assets", "kyc-documents"] as const;
type AssetCategory = (typeof ALLOWED_CATEGORIES)[number];

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const CATEGORY_MAX_SIZE: Record<AssetCategory, number> = {
    "customer-uploads": 10 * 1024 * 1024, // 10MB
    "shop-assets": 10 * 1024 * 1024, // 10MB
    "kyc-documents": 5 * 1024 * 1024, // 5MB
};

function assertSafeSize(file: Express.Multer.File, category: AssetCategory): void {
    const maxSize = CATEGORY_MAX_SIZE[category] ?? DEFAULT_MAX_SIZE;
    if (file.size > maxSize) {
        throw new Error(`File too large. Max size: ${maxSize / 1024 / 1024}MB`);
    }
}

export const uploadAssetService = {
    async uploadAsset(
        userId: string,
        file: Express.Multer.File,
        category: AssetCategory = "customer-uploads",
        productId?: string,
    ) {
        if (!ALLOWED_CATEGORIES.includes(category)) {
            throw new Error(`Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(", ")}`);
        }
        assertSafeSize(file, category);

        let allowedTypes: readonly DetectedFileType[] = DEFAULT_ALLOWED_TYPES;
        if (productId) {
            const product = await db.product.findUnique({
                where: { id: productId },
                select: { customizationEnabled: true, customizationAcceptedFormats: true },
            });
            if (!product) throw new Error("Product not found");
            if (!product.customizationEnabled) {
                throw new Error("Customization is not enabled for this product");
            }
            if (product.customizationAcceptedFormats.length === 0) {
                throw new Error("This product has no accepted customization formats configured");
            }
            allowedTypes = product.customizationAcceptedFormats as DetectedFileType[];
        }

        const detected = detectFileSignature(file.buffer);
        let detectedType: string | null = detected;
        let ext: string | undefined = detected ? EXT_BY_TYPE[detected] : undefined;

        // Address sheets and other spreadsheet uploads: signature sniffing can't
        // identify them, so fall back to content heuristic + declared type/ext.
        if ((!detected || !allowedTypes.includes(detected)) && isSpreadsheetContent(file.buffer)) {
            const byExt = Object.entries(SPREADSHEET_TYPES).find(([, e]) =>
                file.originalname.toLowerCase().endsWith(e),
            );
            const sheetType = SPREADSHEET_TYPES[file.mimetype] ? file.mimetype : byExt?.[0];
            if (sheetType) {
                detectedType = sheetType;
                ext = SPREADSHEET_TYPES[sheetType] ?? byExt?.[1];
            }
        }

        if (!detectedType || (!allowedTypes.includes(detectedType as DetectedFileType) && !SPREADSHEET_TYPES[detectedType])) {
            throw new Error(
                `File content does not match an allowed type. Allowed: ${[...allowedTypes, ...Object.keys(SPREADSHEET_TYPES)].join(", ")}`,
            );
        }

        const safeKey = `${category}/${userId}/${Date.now()}-${randomUUID()}${ext ?? ""}`;

        const storage = StorageFactory.get();
        const upload = await storage.upload({
            key: safeKey,
            buffer: file.buffer,
            mimeType: detectedType,
            size: file.size,
            contentDisposition: "attachment",
        });

        return db.customerUploadAsset.create({
            data: {
                userId,
                productId: productId ?? null,
                url: upload.url,
                key: upload.key,
                fileType: detectedType,
            },
        });
    },

    async listRecent(userId: string, limit = 20) {
        const cappedLimit = Math.min(limit, 100);
        return db.customerUploadAsset.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: cappedLimit,
        });
    },

    async deleteAsset(userId: string, assetId: string) {
        const asset = await db.customerUploadAsset.findFirst({ where: { id: assetId, userId } });
        if (!asset) throw new Error("Asset not found");

        const storage = StorageFactory.get();
        await storage.delete({ key: asset.key }).catch(() => null);

        await db.customerUploadAsset.delete({ where: { id: assetId } });
        return { deleted: true };
    },
};
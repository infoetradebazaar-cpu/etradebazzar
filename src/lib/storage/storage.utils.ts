import { randomUUID } from "crypto";
import path from "path";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export function generateProductImageKey(sellerId: string, productId: string, filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return `sellers/${sellerId}/products/${productId}/images/${randomUUID()}${ext}`;
}

export function generateShopLogoKey(sellerId: string, shopId: string, filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return `sellers/${sellerId}/shops/${shopId}/logo${ext}`;
}

export function generateShopBannerKey(sellerId: string, shopId: string, filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return `sellers/${sellerId}/shops/${shopId}/banner${ext}`;
}

export function generateProductModel3DKey(sellerId: string, productId: string, format: "glb" | "gltf"): string {
    return `sellers/${sellerId}/products/${productId}/model3d/${randomUUID()}.${format}`;
}

export function validateImageFile(file: { mimetype: string; size: number }): void {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
        throw new Error(`Invalid file type. Allowed: ${ALLOWED_IMAGE_TYPES.join(", ")}`);
    }
    if (file.size > MAX_IMAGE_SIZE) {
        throw new Error(`File too large. Max size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
    }
}
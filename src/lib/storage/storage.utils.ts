import { randomUUID } from "crypto";
import path from "path";
import { validateFileContent, type DetectedFileType } from "./file-signature";

const ALLOWED_IMAGE_TYPES: readonly DetectedFileType[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
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

export function generateProductVideoKey(sellerId: string, productId: string, format: "mp4" | "webm" | "mov" | "mkv"): string {
    return `sellers/${sellerId}/products/${productId}/video/${randomUUID()}.${format}`;
}

export function validateImageFile(file: { buffer: Buffer; size: number }): DetectedFileType {
    if (file.size > MAX_IMAGE_SIZE) {
        throw new Error(`File too large. Max size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
    }
    return validateFileContent(file.buffer, ALLOWED_IMAGE_TYPES);
}
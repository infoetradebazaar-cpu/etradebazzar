import { db } from "../../db/index";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { generateProductVideoKey } from "../../lib/storage/storage.utils";
import { validateFileContent, DetectedFileType } from "../../lib/storage/file-signature";

const ALLOWED_VIDEO_TYPES: readonly DetectedFileType[] = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
];
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB

const FORMAT_BY_TYPE: Partial<Record<DetectedFileType, "mp4" | "webm" | "mov" | "mkv">> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
};

export const productVideoService = {
  async upload(sellerId: string, productId: string, file: Express.Multer.File) {
    const product = await db.product.findFirst({ where: { id: productId, sellerId } });
    if (!product) throw new Error("Product not found");

    if (file.size > MAX_VIDEO_SIZE) {
      throw new Error(`File too large. Max size: ${MAX_VIDEO_SIZE / 1024 / 1024}MB`);
    }
    const detected = validateFileContent(file.buffer, ALLOWED_VIDEO_TYPES);
    const format = FORMAT_BY_TYPE[detected]!;

    const key = generateProductVideoKey(sellerId, productId, format);
    const storage = StorageFactory.get();
    const uploaded = await storage.upload({
      key,
      buffer: file.buffer,
      mimeType: detected,
      size: file.size,
    });

    const existing = await db.productVideo.findUnique({ where: { productId } });
    if (existing) {
      await storage.delete({ key: existing.key }).catch(() => null);
    }

    return db.$transaction(async (tx) => {
      if (existing) {
        return tx.productVideo.update({
          where: { id: existing.id },
          data: { key: uploaded.key, format, sizeBytes: file.size },
        });
      }
      try {
        return await tx.productVideo.create({
          data: { productId, key: uploaded.key, format, sizeBytes: file.size },
        });
      } catch (err: any) {
        if (err.code === "P2002") {
          throw new Error("A video already exists for this product retry the upload");
        }
        throw err;
      }
    });
  },

  async get(productId: string) {
    const video = await db.productVideo.findUnique({ where: { productId } });
    if (!video) return null;
    const storage = StorageFactory.get();
    const url = await storage.getSignedUrl({
      key: video.key,
      expiresIn: 3600,
      responseContentDisposition: "inline",
    });
    return { ...video, url };
  },

  async delete(sellerId: string, productId: string) {
    const product = await db.product.findFirst({ where: { id: productId, sellerId } });
    if (!product) throw new Error("Product not found");

    const video = await db.productVideo.findUnique({ where: { productId } });
    if (!video) throw new Error("Video not found");

    const storage = StorageFactory.get();
    await storage.delete({ key: video.key }).catch(() => null);
    await db.productVideo.delete({ where: { id: video.id } });
    return { deleted: true };
  },
};

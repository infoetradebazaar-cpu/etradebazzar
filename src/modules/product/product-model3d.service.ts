import { db } from "../../db/index";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { generateProductModel3DKey } from "../../lib/storage/storage.utils";
import { validateFileContent, DetectedFileType } from "../../lib/storage/file-signature";

const ALLOWED_3D_TYPES: readonly DetectedFileType[] = ["model/gltf-binary", "model/gltf+json"];
const MAX_3D_MODEL_SIZE = 50 * 1024 * 1024; // 50MB

async function findModel3D(productId: string, skuId: string | null) {
  return skuId
    ? db.productModel3D.findUnique({ where: { productId_skuId: { productId, skuId } } })
    : db.productModel3D.findFirst({ where: { productId, skuId: null } });
}

export const productModel3dService = {
  async upload(sellerId: string, productId: string, file: Express.Multer.File, skuId: string | null = null) {
    const product = await db.product.findFirst({ where: { id: productId, sellerId } });
    if (!product) throw new Error("Product not found");
    if (skuId) {
      const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
      if (!sku) throw new Error("SKU not found");
    }

    if (file.size > MAX_3D_MODEL_SIZE) {
      throw new Error(`File too large. Max size: ${MAX_3D_MODEL_SIZE / 1024 / 1024}MB`);
    }
    // browsers rarely set it correctly for .glb/.gltf.
    const detected = validateFileContent(file.buffer, ALLOWED_3D_TYPES);
    const format = detected === "model/gltf-binary" ? "glb" : "gltf";

    const key = generateProductModel3DKey(sellerId, productId, format);
    const storage = StorageFactory.get();
    const uploaded = await storage.upload({
      key,
      buffer: file.buffer,
      mimeType: detected,
      size: file.size,
      contentDisposition: "attachment",
    });

    const existing = await findModel3D(productId, skuId);
    if (existing) {
      await storage.delete({ key: existing.key }).catch(() => null);
    }

    return db.$transaction(async (tx) => {
      if (existing) {
        return tx.productModel3D.update({
          where: { id: existing.id },
          data: { key: uploaded.key, format, sizeBytes: file.size },
        });
      }
      try {
        return await tx.productModel3D.create({
          data: { productId, skuId, key: uploaded.key, format, sizeBytes: file.size },
        });
      } catch (err: any) {
        if (err.code === "P2002") {
          throw new Error(
            skuId
              ? "A 3D model already exists for this variant retry the upload"
              : "A 3D model already exists for this product retry the upload",
          );
        }
        throw err;
      }
    });
  },

  async get(productId: string, skuId: string | null = null) {
    const model = await findModel3D(productId, skuId);
    if (!model) return null;
    const storage = StorageFactory.get();
    const url = await storage.getSignedUrl({ key: model.key, expiresIn: 3600 });
    return { ...model, url };
  },

  async delete(sellerId: string, productId: string, skuId: string | null = null) {
    const product = await db.product.findFirst({ where: { id: productId, sellerId } });
    if (!product) throw new Error("Product not found");

    const model = await findModel3D(productId, skuId);
    if (!model) throw new Error("3D model not found");

    const storage = StorageFactory.get();
    await storage.delete({ key: model.key }).catch(() => null);
    await db.productModel3D.delete({ where: { id: model.id } });
    return { deleted: true };
  },
};

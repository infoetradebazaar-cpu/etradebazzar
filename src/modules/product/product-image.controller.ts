import { Request, Response } from "express";
import { productImageService } from "./product-image.service";
import { logger } from "../../utils/logger";

export const productImageController = {
    async uploadImage(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId } = req.params;
            const file = req.file;
            const skuId = req.body.skuId || null;

            if (!file) {
                return res.status(400).json({ success: false, error: "Image file required" });
            }

            const result = await productImageService.uploadImage(sellerId, String(productId), file, skuId);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Upload product image failed");
            const clientErrors = [
                "Product not found",
                "SKU not found",
                "Invalid file type",
                "File too large",
                "Maximum",
            ];
            if (clientErrors.some((e) => error.message.startsWith(e))) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async deleteImage(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId, imageId } = req.params;
            await productImageService.deleteImage(sellerId, String(productId), String(imageId));
            return res.json({ success: true, message: "Image deleted" });
        } catch (error: any) {
            logger.error({ err: error.message }, "Delete product image failed");
            const clientErrors = ["Product not found", "Image not found"];
            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async reorderImages(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId } = req.params;
            const { orderedIds } = req.body;
            const result = await productImageService.reorderImages(sellerId, String(productId), orderedIds);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Reorder product images failed");
            const clientErrors = ["Product not found"];
            if (clientErrors.includes(error.message) || error.message.includes("not found for this product")) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listImages(req: Request, res: Response) {
        try {
            const { productId } = req.params;
            const skuId = req.query.skuId as string | undefined;
            const result = await productImageService.listImages(String(productId), skuId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "List product images failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
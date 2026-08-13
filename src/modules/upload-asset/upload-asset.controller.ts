import { Request, Response } from "express";
import { uploadAssetService } from "./upload-asset.service";
import { logger } from "../../utils/logger";

export const uploadAssetController = {
    async uploadAsset(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const file = req.file as Express.Multer.File;
            if (!file) return res.status(400).json({ success: false, error: "File required" });
            const category = req.body.category as string | "shop-assets";
            const productId = req.body.productId as string | undefined;
            const result = await uploadAssetService.uploadAsset(userId, file, category as any, productId);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Upload asset failed");
            const clientErrors = [
                "Invalid category",
                "File too large",
                "Product not found",
                "Customization is not enabled",
                "This product has no accepted customization formats",
                "File content does not match an allowed type",
            ];
            if (clientErrors.some((prefix) => error.message.startsWith(prefix))) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listRecent(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { limit } = req.query as Record<string, string>;
            const result = await uploadAssetService.listRecent(userId, limit ? Number(limit) : undefined);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async deleteAsset(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { assetId } = req.params;
            const result = await uploadAssetService.deleteAsset(userId, assetId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            if (error.message === "Asset not found") return res.status(404).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
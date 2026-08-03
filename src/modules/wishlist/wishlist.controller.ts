import { Request, Response } from "express";
import { wishlistService } from "./wishlist.service";
import { logger } from "../../utils/logger";

const clientErrors = ["Product not found", "Wishlist item not found"];

export const wishlistController = {
    async list(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await wishlistService.list(userId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async addItem(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await wishlistService.addItem(userId, req.body);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Add wishlist item failed");
            if (clientErrors.includes(error.message)) return res.status(400).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async removeItem(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { productId } = req.params;
            const skuId = req.query.skuId as string | undefined;
            const result = await wishlistService.removeItem(userId, productId as string, skuId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Remove wishlist item failed");
            if (clientErrors.includes(error.message)) return res.status(404).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};

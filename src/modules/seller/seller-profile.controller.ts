import { Request, Response } from "express";
import { sellerProfileService } from "./seller-profile.service";
import { logger } from "../../utils/logger";

export const sellerProfileController = {
    async getProfile(req: Request, res: Response) {
        try {
            const result = await sellerProfileService.getProfile(req.seller!.id);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get profile failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async updateProfile(req: Request, res: Response) {
        try {
            const result = await sellerProfileService.updateProfile(
                req.seller!.id,
                req.user!.id,
                req.body,
                { ipAddress: req.ip, userAgent: req.get("User-Agent") }
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Update profile failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getBusiness(req: Request, res: Response) {
        try {
            const result = await sellerProfileService.getBusiness(req.seller!.id);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get business failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async updateBusiness(req: Request, res: Response) {
        try {
            const result = await sellerProfileService.updateBusiness(req.seller!.id, req.body);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Update business failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getVerificationBadges(req: Request, res: Response) {
        try {
            const result = await sellerProfileService.getVerificationBadges(req.seller!.id);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get verification badges failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getShopStats(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { shopId } = req.params;
            const result = await sellerProfileService.getShopStats(sellerId, shopId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get shop stats failed");
            if (error.message === "Shop not found") return res.status(404).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
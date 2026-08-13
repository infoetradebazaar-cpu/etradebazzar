import { Request, Response } from "express";
import { savedDesignService } from "./saved-design.service";
import { logger } from "../../utils/logger";

const CLIENT_ERRORS = ["Product not found", "SKU not found", "Saved design not found"];

function isClientError(message: string): boolean {
    return CLIENT_ERRORS.includes(message);
}

export const savedDesignController = {
    async create(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await savedDesignService.create(userId, req.body);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Create saved design failed");
            if (isClientError(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async list(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await savedDesignService.list(userId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "List saved designs failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async get(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { designId } = req.params;
            const result = await savedDesignService.get(userId, String(designId));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get saved design failed");
            if (isClientError(error.message)) {
                return res.status(404).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async update(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { designId } = req.params;
            const result = await savedDesignService.update(userId, String(designId), req.body);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Update saved design failed");
            if (isClientError(error.message)) {
                return res.status(404).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async delete(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { designId } = req.params;
            const result = await savedDesignService.delete(userId, String(designId));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Delete saved design failed");
            if (isClientError(error.message)) {
                return res.status(404).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};

import { Request, Response } from "express";
import { customizationOptionService } from "./customization-option.service";
import { logger } from "../../utils/logger";

const CLIENT_ERRORS = [
    "Product not found",
    "Option group not found",
    "Option not found",
    'Option group "',
    'Option "',
];

function isClientError(message: string): boolean {
    return CLIENT_ERRORS.some((prefix) => message.startsWith(prefix.split('"')[0]!));
}

export const customizationOptionController = {
    async listForProduct(req: Request, res: Response) {
        try {
            const { productId } = req.params;
            const result = await customizationOptionService.listForProduct(String(productId));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "List customization options failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async createGroup(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId } = req.params;
            const result = await customizationOptionService.createGroup(sellerId, String(productId), req.body);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Create option group failed");
            if (isClientError(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async updateGroup(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId, groupId } = req.params;
            const result = await customizationOptionService.updateGroup(
                sellerId, String(productId), String(groupId), req.body,
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Update option group failed");
            if (isClientError(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async deleteGroup(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId, groupId } = req.params;
            const result = await customizationOptionService.deleteGroup(sellerId, String(productId), String(groupId));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Delete option group failed");
            if (isClientError(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async createOption(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId, groupId } = req.params;
            const result = await customizationOptionService.createOption(
                sellerId, String(productId), String(groupId), req.body,
            );
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Create option failed");
            if (isClientError(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async updateOption(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId, groupId, optionId } = req.params;
            const result = await customizationOptionService.updateOption(
                sellerId, String(productId), String(groupId), String(optionId), req.body,
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Update option failed");
            if (isClientError(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async deleteOption(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { productId, groupId, optionId } = req.params;
            const result = await customizationOptionService.deleteOption(
                sellerId, String(productId), String(groupId), String(optionId),
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Delete option failed");
            if (isClientError(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};

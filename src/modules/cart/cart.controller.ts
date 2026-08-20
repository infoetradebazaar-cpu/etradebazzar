import { Request, Response } from "express";
import { cartService } from "./cart.service";
import { logger } from "../../utils/logger";

const clientErrors = [
    "Product not found", "Product not available", "Insufficient stock",
    "Cart item not found", "Quantity must be greater than 0", "Cart is empty",
    "Cart has no seller assigned", "Address not found", "Delivery address required",
];

export const cartController = {
    async getCart(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await cartService.getCart(userId, req.customerOrg?.orgId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async addItem(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await cartService.addItem(userId, req.body, req.customerOrg?.orgId);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Add cart item failed");
            if (clientErrors.includes(error.message)) return res.status(400).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async updateItem(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { itemId } = req.params;
            const { quantity } = req.body;
            const result = await cartService.updateItem(userId, itemId as string, quantity, req.customerOrg?.orgId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Update cart item failed");
            if (clientErrors.includes(error.message)) return res.status(400).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async removeItem(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { itemId } = req.params;
            const result = await cartService.removeItem(userId, itemId as string, req.customerOrg?.orgId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Remove cart item failed");
            if (clientErrors.includes(error.message)) return res.status(400).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async clearCart(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await cartService.clearCart(userId, req.customerOrg?.orgId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async checkout(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { idempotencyKey, ...checkoutData } = req.body;
            const result = await cartService.checkout(userId, idempotencyKey, checkoutData, req.customerOrg?.orgId);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Checkout failed");
            if (error.message === "Duplicate order submission detected, please wait") {
                return res.status(409).json({ success: false, error: error.message });
            }
            if (clientErrors.includes(error.message)) return res.status(400).json({ success: false, error: error.message });
            return res.status(400).json({ success: false, error: error.message });
        }
    },
};
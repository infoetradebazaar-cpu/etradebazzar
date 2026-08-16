import type { Request, Response } from "express";
import { returnService } from "./return.service";
import { logger } from "../../utils/logger";

export const returnController = {
    async createReturnRequest(req: Request, res: Response) {
        try {
            const customerId = req.user!.id;
            const result = await returnService.createReturnRequest(customerId, req.body);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Create return request failed");
            const clientErrors = [
                "Order not found",
                "Unauthorized",
                "Order not delivered yet",
                "Return request already exists",
                "One or more images are invalid or already attached",
            ];
            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async approveReturn(req: Request, res: Response) {
        try {
            const { returnId } = req.params;
            const sellerId = req.seller!.id;
            const actorId = req.user!.id;
            const { note } = req.body;
            const result = await returnService.approveReturn(returnId as string, sellerId, actorId, note);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Approve return failed");
            const clientErrors = [
                "Return request not found",
                "Return request not pending",
                "Order address not found",
                "Shop not found",
            ];
            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async rejectReturn(req: Request, res: Response) {
        try {
            const { returnId } = req.params;
            const sellerId = req.seller!.id;
            const actorId = req.user!.id;
            const { note } = req.body;
            const result = await returnService.rejectReturn(returnId as string, sellerId, actorId, note);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Reject return failed");
            const clientErrors = ["Return request not found", "Return request not pending"];
            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getReturnRequest(req: Request, res: Response) {
        try {
            const { returnId } = req.params;
            const sellerId = req.seller!.id;
            const result = await returnService.getReturnRequest(returnId as string, sellerId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get return request failed");
            if (error.message === "Return request not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listReturnRequests(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const userId = req.user!.id;
            const { status, search, reason, dateFrom, dateTo, page, limit } = req.query as Record<string, string>;
            const result = await returnService.listReturnRequests(sellerId, userId, {
                status, search, reason, dateFrom, dateTo,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List returns failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listAllReturnRequests(req: Request, res: Response) {
        try {
            const { status, search, reason, sellerId, dateFrom, dateTo, page, limit } = req.query as Record<string, string>;
            const result = await returnService.listAllReturnRequests({
                status, search, reason, sellerId, dateFrom, dateTo,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List all returns (admin) failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getReturnRequestForAdmin(req: Request, res: Response) {
        try {
            const { returnId } = req.params;
            const result = await returnService.getReturnRequestForAdmin(returnId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get return request (admin) failed");
            if (error.message === "Return request not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listCustomerReturns(req: Request, res: Response) {
        try {
            const customerId = req.user!.id;
            const result = await returnService.listCustomerReturns(customerId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "List customer returns failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
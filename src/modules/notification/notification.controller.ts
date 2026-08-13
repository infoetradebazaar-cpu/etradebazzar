import { Request, Response } from "express";
import { notificationService } from "./notification.service";
import { sseManager } from "../../lib/notifications/sse/sse.manager";
import { logger } from "../../utils/logger";
import { signSseToken } from "../../utils/jwt";

export const notificationController = {
    stream(req: Request, res: Response) {
        const userId = req.user!.id;
        sseManager.connect(userId, req, res);
    },

    getStreamToken(req: Request, res: Response) {
        const token = signSseToken(req.user!.id);
        return res.json({ success: true, data: { token, expiresIn: 180 } });
    },

    async getNotifications(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
            const result = await notificationService.getNotifications(userId, page, limit);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get notifications failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async markAsRead(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { ids } = req.body;
            const result = await notificationService.markAsRead(userId, ids);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Mark as read failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async markAllAsRead(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await notificationService.markAllAsRead(userId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Mark all as read failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getPreferences(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await notificationService.getPreferences(userId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get notification preferences failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async updatePreferences(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await notificationService.updatePreferences(userId, req.body.preferences);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Update notification preferences failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
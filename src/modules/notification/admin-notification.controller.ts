import { Request, Response } from "express";
import { NOTIFICATION_EVENT_CATALOG } from "./notification.catalog";
import { adminNotificationService } from "./admin-notification.service";
import { logger } from "../../utils/logger";

function classifyError(res: Response, error: any, label: string) {
    logger.error({ err: error.message }, label);
    if (error.message === "Unknown notification type") {
        return res.status(404).json({ success: false, error: error.message });
    }
    if (
        error.message.includes("is not an email-capable event") ||
        error.message === "Subject cannot be empty" ||
        error.message === "Body cannot be empty"
    ) {
        return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: "Internal server error" });
}

export const adminNotificationController = {
    listEventCatalog(_req: Request, res: Response) {
        try {
            return res.json({ success: true, data: Object.values(NOTIFICATION_EVENT_CATALOG) });
        } catch (error: any) {
            logger.error({ err: error.message }, "List notification event catalog failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getTemplate(req: Request, res: Response) {
        try {
            const { type } = req.params;
            const result = await adminNotificationService.getTemplate(type as any);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Get notification template failed");
        }
    },

    async upsertTemplate(req: Request, res: Response) {
        try {
            const { type } = req.params;
            const actorId = req.user!.id;
            const { subject, bodyHtml } = req.body;
            const result = await adminNotificationService.upsertTemplate(type as any, { subject, bodyHtml }, actorId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Upsert notification template failed");
        }
    },

    async revertTemplate(req: Request, res: Response) {
        try {
            const { type } = req.params;
            const result = await adminNotificationService.revertTemplate(type as any);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return classifyError(res, error, "Revert notification template failed");
        }
    },

    async listDeliveries(req: Request, res: Response) {
        try {
            const { status, channel, page, limit } = req.query as Record<string, string>;
            const result = await adminNotificationService.listDeliveries({
                status, channel,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List notification deliveries failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};

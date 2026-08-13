import { Request, Response } from "express";
import { adminNegotiationService } from "./admin-negotiation.service";
import { logger } from "../../utils/logger";

export const adminNegotiationController = {
  async listSessions(req: Request, res: Response) {
    try {
      const { mode, status, page, limit } = req.query as Record<string, string>;
      const result = await adminNegotiationService.listSessions({
        mode: mode as "AUTO" | "MANUAL" | undefined,
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Admin list negotiation sessions failed");
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async getSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const result = await adminNegotiationService.getSession(String(sessionId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Admin get negotiation session failed");
      if (error.message === "Negotiation session not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
};

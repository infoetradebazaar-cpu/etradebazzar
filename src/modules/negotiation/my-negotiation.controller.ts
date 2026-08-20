import { Request, Response } from "express";
import { myNegotiationService } from "./my-negotiation.service";
import { logger } from "../../utils/logger";

function actor(req: Request): { actorId: string; actorType: "customer" | "seller" } {
  if (req.seller?.id) return { actorId: req.seller.id, actorType: "seller" };
  return { actorId: req.user!.id, actorType: "customer" };
}

export const myNegotiationController = {
  async listSessions(req: Request, res: Response) {
    try {
      const { actorId, actorType } = actor(req);
      const { status, page, limit } = req.query as Record<string, string>;
      const result = await myNegotiationService.listSessions(actorId, actorType, {
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }, req.customerOrg?.orgId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List my negotiation sessions failed");
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
};

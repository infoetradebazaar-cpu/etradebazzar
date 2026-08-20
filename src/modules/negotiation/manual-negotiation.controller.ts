import { Request, Response } from "express";
import { manualNegotiationService } from "./manual-negotiation.service";
import { InsufficientStockError } from "./negotiation-order.helper";
import { logger } from "../../utils/logger";

const CLIENT_ERRORS = [
  "SKU not found",
  "This quantity is eligible for auto-negotiation",
  "A negotiation session is already open",
  "Negotiation session not found",
  "This session is not a manual negotiation",
  "This negotiation is already resolved",
  "Chat session not found",
  "No time slot has been proposed yet",
  "Waiting on the other party to confirm",
  "Product not found",
];

function isClientError(message: string): boolean {
  return CLIENT_ERRORS.some((prefix) => message.startsWith(prefix));
}

function actor(req: Request): { actorId: string; actorType: "customer" | "seller" } {
  if (req.seller?.id) return { actorId: req.seller.id, actorType: "seller" };
  return { actorId: req.user!.id, actorType: "customer" };
}

export const manualNegotiationController = {
  async startSession(req: Request, res: Response) {
    try {
      const customerId = req.user!.id;
      const { sellerId, productId, skuId, quantity } = req.body;
      const result = await manualNegotiationService.startSession(customerId, sellerId, productId, skuId, quantity, req.customerOrg?.orgId);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Start manual negotiation failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async getSession(req: Request, res: Response) {
    try {
      const { actorId, actorType } = actor(req);
      const { sessionId } = req.params;
      const result = await manualNegotiationService.getSession(actorId, actorType, String(sessionId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get manual negotiation session failed");
      if (isClientError(error.message)) {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async sendMessage(req: Request, res: Response) {
    try {
      const { actorId, actorType } = actor(req);
      const { sessionId } = req.params;
      const { body } = req.body;
      const result = await manualNegotiationService.sendMessage(actorId, actorType, String(sessionId), body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Send negotiation message failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async proposeTimeSlot(req: Request, res: Response) {
    try {
      const { actorId, actorType } = actor(req);
      const { sessionId } = req.params;
      const { timeSlot } = req.body;
      const result = await manualNegotiationService.proposeTimeSlot(
        actorId,
        actorType,
        String(sessionId),
        new Date(timeSlot),
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Propose time slot failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async confirmTimeSlot(req: Request, res: Response) {
    try {
      const { actorId, actorType } = actor(req);
      const { sessionId } = req.params;
      const result = await manualNegotiationService.confirmTimeSlot(actorId, actorType, String(sessionId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Confirm time slot failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async accept(req: Request, res: Response) {
    try {
      const customerId = req.user!.id;
      const { sessionId } = req.params;
      const { finalPrice, deliveryAddress } = req.body;
      const result = await manualNegotiationService.accept(
        customerId,
        String(sessionId),
        finalPrice,
        deliveryAddress,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Accept manual negotiation failed");
      if (error instanceof InsufficientStockError) {
        return res.status(409).json({ success: false, error: error.message, code: "INSUFFICIENT_STOCK" });
      }
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async reject(req: Request, res: Response) {
    try {
      const { actorId, actorType } = actor(req);
      const { sessionId } = req.params;
      const result = await manualNegotiationService.reject(actorId, actorType, String(sessionId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Reject manual negotiation failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
};

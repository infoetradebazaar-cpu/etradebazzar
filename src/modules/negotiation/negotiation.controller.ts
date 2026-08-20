import { Request, Response } from "express";
import { autoNegotiationService } from "./auto-negotiation.service";
import { InsufficientStockError } from "./negotiation-order.helper";
import { logger } from "../../utils/logger";

const CLIENT_ERRORS = [
  "SKU not found",
  "Quantity is beyond auto-negotiable tiers",
  "Auto-negotiation is not available",
  "A negotiation session is already open",
  "Negotiation session not found",
  "This session is not an auto-negotiation",
  "This negotiation is already resolved",
  "Negotiation round not found",
  "Delivery address is required",
  "Your offer meets our price",
  "This round has already been responded to",
  "Product not found",
];

function isClientError(message: string): boolean {
  return CLIENT_ERRORS.some((prefix) => message.startsWith(prefix));
}

export const negotiationController = {
  async startAutoSession(req: Request, res: Response) {
    try {
      const customerId = req.user!.id;
      const { sellerId, productId, skuId, quantity, customerPrice } = req.body;
      const result = await autoNegotiationService.startSession(
        customerId,
        sellerId,
        productId,
        skuId,
        quantity,
        customerPrice,
        req.customerOrg?.orgId,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Start auto-negotiation failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async getSession(req: Request, res: Response) {
    try {
      const customerId = req.user!.id;
      const { sessionId } = req.params;
      const result = await autoNegotiationService.getSession(customerId, String(sessionId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get negotiation session failed");
      if (isClientError(error.message)) {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async respond(req: Request, res: Response) {
    try {
      const customerId = req.user!.id;
      const { sessionId } = req.params;
      const { action, deliveryAddress, customerPrice } = req.body;
      const result = await autoNegotiationService.respond(
        customerId,
        String(sessionId),
        action,
        deliveryAddress,
        customerPrice,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Respond to negotiation failed");
      if (error instanceof InsufficientStockError) {
        return res.status(409).json({ success: false, error: error.message, code: "INSUFFICIENT_STOCK" });
      }
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
};

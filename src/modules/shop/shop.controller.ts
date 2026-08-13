import { Request, Response } from "express";
import { shopService } from "./shop.service";
import { logger } from "../../utils/logger";

export const shopController = {
  async createShop(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const result = await shopService.createShop(sellerId, actorId, req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create shop failed");
      const clientErrors = [
        "Seller not found",
        "Seller not approved",
        "Pickup city and state could not be determined from the provided pincode. Please provide them manually.",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateShop(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { shopId } = req.params;
      const result = await shopService.updateShop(
        sellerId,
        actorId,
        String(shopId),
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update shop failed");
      const clientErrors = [
        "Shop not found",
        "Cannot update rejected shop",
        "Pickup city and state could not be determined from the provided pincode. Please provide them manually.",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getShop(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const userId = req.user!.id;
      const { shopId } = req.params;
      const result = await shopService.getShop(sellerId, userId, shopId as string);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.message === "You do not have access to this shop") return res.status(403).json({ success: false, error: error.message });
      if (error.message === "Shop not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listShops(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const userId = req.user!.id;
      const { search, status, page, limit } = req.query as Record<
        string,
        string
      >;
      const result = await shopService.listShops(sellerId, userId, {
        search,
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List shops failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listAllShops(req: Request, res: Response) {
    try {
      const { search, status, sellerId, page, limit } = req.query as Record<
        string,
        string
      >;
      const result = await shopService.listAllShops({
        search,
        status,
        sellerId,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List all shops failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async setAutoAssign(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { shopId } = req.params;
      const { enabled } = req.body;
      const result = await shopService.setAutoAssign(sellerId, shopId as string, enabled);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      if (error.message === "Shop not found") return res.status(404).json({ success: false, error: error.message });
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  // async approveShop(req: Request, res: Response) {
  //   try {
  //     const { shopId } = req.params;
  //     const actorId = req.user!.id;
  //     const { note } = req.body;
  //     const result = await shopService.approveShop(shopId, actorId, note);
  //     return res.json({ success: true, data: result });
  //   } catch (error: any) {
  //     logger.error({ err: error.message }, "Approve shop failed");
  //     const clientErrors = ["Shop not found", "Shop is not pending"];
  //     if (clientErrors.includes(error.message)) {
  //       return res.status(400).json({ success: false, error: error.message });
  //     }
  //     return res.status(500).json({ success: false, error: "Internal server error" });
  //   }
  // },

  // async rejectShop(req: Request, res: Response) {
  //   try {
  //     const { shopId } = req.params;
  //     const actorId = req.user!.id;
  //     const { reason } = req.body;
  //     const result = await shopService.rejectShop(shopId, actorId, reason);
  //     return res.json({ success: true, data: result });
  //   } catch (error: any) {
  //     logger.error({ err: error.message }, "Reject shop failed");
  //     const clientErrors = ["Shop not found", "Shop is not pending"];
  //     if (clientErrors.includes(error.message)) {
  //       return res.status(400).json({ success: false, error: error.message });
  //     }
  //     return res.status(500).json({ success: false, error: "Internal server error" });
  //   }
  // },

  // async listPendingShops(req: Request, res: Response) {
  //   try {
  //     const result = await shopService.listPendingShops();
  //     return res.json({ success: true, data: result });
  //   } catch (error: any) {
  //     logger.error({ err: error.message }, "List pending shops failed");
  //     return res.status(500).json({ success: false, error: "Internal server error" });
  //   }
  // },
};

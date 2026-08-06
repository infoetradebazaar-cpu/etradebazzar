import type { Request, Response } from "express";
import { payoutService } from "./payout.service";
import { logger } from "../../utils/logger";
import { toCsv } from "../../utils/csv";

export const payoutController = {
  async getMyPayoutSummary(req: Request, res: Response) {
    try {
      if (!req.seller) {
        return res
          .status(403)
          .json({ success: false, error: "Seller context not found" });
      }
      const result = await payoutService.getSellerPayoutSummary(req.seller.id);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get my payout summary failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getMyPayoutHistory(req: Request, res: Response) {
    try {
      if (!req.seller) {
        return res
          .status(403)
          .json({ success: false, error: "Seller context not found" });
      }
      const { status, search, dateFrom, dateTo, page, limit } =
        req.query as Record<string, string>;
      const result = await payoutService.getPayoutHistory(req.seller.id, {
        status,
        search,
        dateFrom,
        dateTo,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get my payout history failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getMyPayoutById(req: Request, res: Response) {
    try {
      if (!req.seller) {
        return res
          .status(403)
          .json({ success: false, error: "Seller context not found" });
      }
      const { payoutId } = req.params;
      const result = await payoutService.getMyPayoutById(req.seller.id, payoutId as string);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get my payout by id failed");
      if (error.message === "Payout not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async setPlatformConfig(req: Request, res: Response) {
    try {
      const actorId = req.user!.id;
      const { key, value } = req.body;
      const result = await payoutService.setPlatformConfig(key, value, actorId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Set platform config failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listAllSellersSummary(req: Request, res: Response) {
    try {
      const result = await payoutService.listAllSellersSummary();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List sellers summary failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getSellerPayoutSummary(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const result = await payoutService.getSellerPayoutSummary(
        sellerId as string,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get seller payout summary failed");
      if (error.message === "Seller not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async initiatePayout(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const result = await payoutService.initiatePayout(
        sellerId as string,
        actorId,
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Initiate payout failed");
      const clientErrors = [
        "Seller not found",
        "Seller bank details not found",
        "No unpaid orders to payout",
        "Net payout amount must be greater than 0",
      ];
      if (
        clientErrors.includes(error.message) ||
        error.message.includes("Seller bank account is not verified")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async webhook(req: Request, res: Response) {
    try {
      const signature = req.headers["x-razorpay-signature"] as string;
      if (!signature) {
        return res.status(400).json({ error: "Missing signature" });
      }
      const result = await payoutService.handleWebhook(req.body, signature);
      return res.json(result);
    } catch (error: any) {
      logger.error({ err: error.message }, "Payout webhook failed");
      if (error.message === "Invalid webhook signature") {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  async getPayoutHistory(req: Request, res: Response) {
    try {
      const { status, search, dateFrom, dateTo, page, limit } =
        req.query as Record<string, string>;
      const result = await payoutService.getPayoutHistory(undefined, {
        status,
        search,
        dateFrom,
        dateTo,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get payout history failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getSellerPayoutHistory(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const { status, search, dateFrom, dateTo, page, limit } =
        req.query as Record<string, string>;
      const result = await payoutService.getPayoutHistory(sellerId as string, {
        status,
        search,
        dateFrom,
        dateTo,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get seller payout history failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getPayoutById(req: Request, res: Response) {
    try {
      const { payoutId } = req.params;
      const result = await payoutService.getPayoutById(payoutId as string);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get payout failed");
      if (error.message === "Payout not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async getPayoutConfig(req: Request, res: Response) {
    try {
      const result = await payoutService.getPayoutConfig();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get payout config failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async exportPayoutsCsv(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const payouts = await payoutService.exportPayoutsCsv(sellerId as string);

      const rows = payouts.map((p) => ({
        payoutId: p.id,
        grossAmount: Number(p.grossAmount),
        commissionAmount: Number(p.commissionAmount),
        netAmount: Number(p.netAmount),
        method: p.method,
        status: p.status,
        utr: p.utrReference ?? "",
        createdAt: p.createdAt.toISOString(),
      }));
      const csv = toCsv(rows, [
        "payoutId",
        "grossAmount",
        "commissionAmount",
        "netAmount",
        "method",
        "status",
        "utr",
        "createdAt",
      ]);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=payouts.csv");
      return res.send(csv);
    } catch (error: any) {
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
};

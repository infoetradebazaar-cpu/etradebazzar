import { Request, Response } from "express";
import { orderService } from "./order.service";
import { logger } from "../../utils/logger";
import { streamCsv } from "../../utils/csv";
import { createBulkOrderSchema } from "./order.schema";
import { InsufficientStockError } from "../../lib/inventory/stock.errors";

export const orderController = {
  async createOrder(req: Request, res: Response) {
    try {
      const customerId = req.user!.id;
      const { idempotencyKey, ...orderData } = req.body;
      const result = await orderService.createOrder(
        customerId,
        idempotencyKey,
        orderData,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create order failed");
      if (error instanceof InsufficientStockError) {
        return res.status(409).json({ success: false, error: error.message, code: "INSUFFICIENT_STOCK" });
      }
      const clientErrors = [
        "One or more products not found or not approved",
        "Sample orders limited to 2 items",
        "Duplicate order submission detected, please wait",
        "Invalid SKU for product",
      ];
      if (clientErrors.includes(error.message)) {
        return res
          .status(error.message.includes("Duplicate") ? 409 : 400)
          .json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async createBulkOrder(req: Request, res: Response) {
    try {
      const customerId = req.user!.id;
      const file = req.file;

      if (!file)
        return res
          .status(400)
          .json({ success: false, error: "XLS file required" });

      const parsedItems =
        typeof req.body.items === "string"
          ? JSON.parse(req.body.items)
          : req.body.items;
      const parsed = createBulkOrderSchema.shape.body.safeParse({
        idempotencyKey: req.body.idempotencyKey,
        sellerId: req.body.sellerId,
        items: parsedItems,
      });
      if (!parsed.success) {
        return res
          .status(400)
          .json({
            success: false,
            error: parsed.error.issues[0]?.message ?? "Invalid request",
          });
      }

      const result = await orderService.createBulkOrder(
        customerId,
        parsed.data.idempotencyKey,
        parsed.data.sellerId,
        parsed.data.items,
        file,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create bulk order failed");
      if (error instanceof InsufficientStockError) {
        return res.status(409).json({ success: false, error: error.message, code: "INSUFFICIENT_STOCK" });
      }
      const clientErrors = [
        "XLS file is empty",
        "One or more products invalid",
        "Duplicate order submission detected, please wait",
        "Invalid SKU for product",
      ];
      if (
        clientErrors.includes(error.message) ||
        error.message.startsWith("Missing columns") ||
        error.message.startsWith("Bulk upload exceeds")
      ) {
        return res
          .status(error.message.includes("Duplicate") ? 409 : 400)
          .json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async assignShopToAddress(req: Request, res: Response) {
    try {
      const { orderId, addressId } = req.params;
      const actorId = req.user!.id;
      const sellerId = req.seller!.id;
      const { shopId } = req.body;
      const result = await orderService.assignShopToAddress(
        orderId as string,
        addressId as string,
        shopId,
        actorId,
        sellerId,
      );
      const updatedOrder = await orderService.getOrder(orderId as string);
      return res.json({ success: true, data: updatedOrder });
    } catch (error: any) {
      logger.error({ err: error.message }, "Assign shop to address failed");
      const clientErrors = [
        "Address not found",
        "Shop not found",
        "Shop not approved",
        "Order not yet approved by seller",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async markPacked(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { orderId } = req.params;
      const result = await orderService.markPacked(
        orderId as string,
        sellerId,
        actorId,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Mark packed failed");
      const clientErrors = [
        "Order not found",
        "Order has no shop assigned yet",
        "Order address not found",
        "Assigned shop does not match the address assignment",
      ];
      if (
        clientErrors.includes(error.message) ||
        error.message.startsWith("Cannot mark packed") ||
        error.message.includes("already packed")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async approveOrder(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { orderId } = req.params;
      const result = await orderService.approveOrder(
        orderId as string,
        sellerId,
        actorId,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Approve order failed");
      const clientErrors = ["Order not found", "Order already approved"];
      if (
        clientErrors.includes(error.message) ||
        error.message.startsWith("Cannot approve")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async rejectOrder(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const actorId = req.user!.id;
      const reason = req.body?.reason;
      const result = await orderService.cancelOrder(
        orderId as string,
        actorId,
        "seller",
        req.user?.id,
        req.seller?.id,
        reason,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Reject order failed");
      if (error.message === "Order not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      if (error.message === "Order cannot be cancelled") {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async confirmCashCollected(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { orderId } = req.params;
      const note = req.body?.note;
      const result = await orderService.confirmCashCollected(
        orderId as string,
        sellerId,
        actorId,
        note,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Confirm cash collected failed");
      const clientErrors = [
        "Order not found",
        "Cash confirmation only applies to COD orders",
        "Cash payment already recorded for this order",
      ];
      if (
        clientErrors.includes(error.message) ||
        error.message.startsWith("Cannot confirm cash")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getOrder(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const result = await orderService.getOrder(
        orderId as string,
        req.user?.id,
        req.seller?.id,
        req.user?.role,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get order failed");
      if (error.message === "Order not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async cancelOrder(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const actorId = req.user!.id;
      const actorType = req.seller?.id ? "seller" : "customer";
      const result = await orderService.cancelOrder(
        orderId as string,
        actorId,
        actorType,
        req.user?.id,
        req.seller?.id,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Cancel order failed");
      if (error.message === "Order not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      if (error.message === "Order cannot be cancelled") {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listOrders(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const userId = req.user!.id;
      const { status, search, type, shopId, dateFrom, dateTo, page, limit, awaitingApproval } =
        req.query as Record<string, string>;
      const result = await orderService.listOrders(sellerId, userId, {
        status,
        search,
        type,
        shopId,
        dateFrom,
        dateTo,
        awaitingApproval: awaitingApproval === "true",
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List orders failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async listAllOrders(req: Request, res: Response) {
    try {
      const {
        status,
        search,
        type,
        sellerId,
        shopId,
        dateFrom,
        dateTo,
        page,
        limit,
      } = req.query as Record<string, string>;
      const result = await orderService.listAllOrders({
        status,
        search,
        type,
        sellerId,
        shopId,
        dateFrom,
        dateTo,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List all orders failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async adminAssignShop(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const { shopId } = req.body;
      const actorId = req.user!.id;
      const result = await orderService.adminAssignShop(orderId as string, shopId, actorId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Admin assign shop failed");
      const clientErrors = [
        "Order not found",
        "Shop not found",
        "Shop not approved",
        "Order not yet approved by seller",
        "Order is not awaiting assignment",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async bulkAction(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const result = await orderService.bulkAction(sellerId, actorId, req.body);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Bulk order action failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getActionRequired(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const result = await orderService.getActionRequired(sellerId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get action required failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async exportOrdersCsv(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { status, type, dateFrom, dateTo } = req.query as Record<
        string,
        string
      >;
      const batches = await orderService.exportOrdersCsv(sellerId, {
        status,
        type,
        dateFrom,
        dateTo,
      });

      const rows = (async function* () {
        for await (const batch of batches) {
          yield batch.map((o) => ({
            orderId: o.displayId ?? o.id,
            type: o.type,
            status: o.status,
            totalAmount: Number(o.totalAmount),
            finalAmount: o.finalAmount ? Number(o.finalAmount) : "",
            paymentStatus: o.paymentStatus,
            customerName: o.customer.name ?? "",
            customerEmail: o.customer.email,
            createdAt: o.createdAt.toISOString(),
          }));
        }
      })();
      await streamCsv(res, "orders.csv", [
        "orderId",
        "type",
        "status",
        "totalAmount",
        "finalAmount",
        "paymentStatus",
        "customerName",
        "customerEmail",
        "createdAt",
      ], rows);
      return;
    } catch (error: any) {
      if (res.headersSent) return res.end();
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listBulkUploads(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const result = await orderService.listBulkUploads(sellerId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List bulk uploads failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
};

import { Request, Response } from "express";
import { productService } from "./product.service";
import { logger } from "../../utils/logger";
import { toCsv } from "../../utils/csv";

const ATTRIBUTE_ERROR_PREFIXES = [
  "Unknown attribute",
  "Missing required attribute",
  "Invalid value for attribute",
];

function isAttributeError(message: string): boolean {
  return ATTRIBUTE_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix));
}

export const productController = {
  async createProduct(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const result = await productService.createProduct(
        sellerId,
        actorId,
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create product failed");
      const clientErrors = [
        "Shop not found",
        "Shop not approved",
        "SKU already exists",
        "KYC not submitted",
        "KYC not verified",
        "Category not found",
      ];
      if (
        clientErrors.includes(error.message) ||
        isAttributeError(error.message)
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async createProductComplete(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const result = await productService.createProductComplete(
        sellerId,
        actorId,
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create product (complete) failed");
      const clientErrors = [
        "Shop not found",
        "Shop not approved",
        "SKU already exists",
        "SKU code already exists",
        "KYC not submitted",
        "KYC not verified",
        "Category not found",
      ];
      if (
        clientErrors.includes(error.message) ||
        isAttributeError(error.message) ||
        error.message.startsWith("Variant attribute") ||
        error.message.startsWith("Variant value") ||
        error.message.startsWith("Invalid variant option") ||
        error.message.startsWith("Invalid value") ||
        error.message.startsWith("Missing option") ||
        error.message.startsWith("Product has no variant options") ||
        error.message.startsWith("A tier at minQty") ||
        error.message.startsWith("Tier ") ||
        error.message.startsWith("Tier range")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateProduct(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { productId } = req.params;
      const result = await productService.updateProduct(
        sellerId,
        actorId,
        productId as string,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update product failed");
      const clientErrors = [
        "Product not found",
        "Cannot update rejected product",
        "SKU already exists",
        "Category not found",
      ];
      if (
        clientErrors.includes(error.message) ||
        isAttributeError(error.message)
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getProduct(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId } = req.params;
      const result = await productService.getProduct(
        sellerId,
        productId as string,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get product failed");
      if (error.message === "Product not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getProductById(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const result = await productService.getProductById(productId as string);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get product by id failed");
      if (error.message === "Product not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listProducts(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { status, search, category, page, limit } = req.query as Record<
        string,
        string
      >;
      const result = await productService.listProducts(sellerId, {
        status,
        search,
        category,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List products failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async approveProduct(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const actorId = req.user!.id;
      const { note, commissionRate } = req.body;
      const result = await productService.approveProduct(
        productId as string,
        actorId,
        commissionRate,
        note,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Approve product failed");
      const clientErrors = ["Product not found", "Product is not pending"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async submitForReview(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { productId } = req.params;
      const result = await productService.submitForReview(
        sellerId,
        actorId,
        productId as string,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Submit product for review failed");
      const clientErrors = ["Product not found", "Only draft products can be submitted for review"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async rejectProduct(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const actorId = req.user!.id;
      const { reason } = req.body;
      const result = await productService.rejectProduct(
        productId as string,
        actorId,
        reason,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Reject product failed");
      const clientErrors = ["Product not found", "Product is not pending"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listPendingProducts(req: Request, res: Response) {
    try {
      const result = await productService.listPendingProducts();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List pending products failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listAllProducts(req: Request, res: Response) {
    try {
      const { status, search, sellerId, page, limit } = req.query as Record<
        string,
        string
      >;
      const result = await productService.listAllProducts({
        status,
        search,
        sellerId,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List all products failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deleteProduct(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { productId } = req.params;
      await productService.deleteProduct(
        sellerId,
        actorId,
        productId as string,
      );
      return res.json({ success: true, message: "Product deleted" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete product failed");
      const clientErrors = [
        "Product not found",
        "Cannot delete approved product",
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
      const result = await productService.bulkAction(
        sellerId,
        actorId,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Bulk product action failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async exportProductsCsv(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const products = await productService.exportProductsCsv(sellerId);

      const rows = products.map((p) => ({
        productId: p.displayId ?? p.id,
        name: p.name,
        sku: p.sku ?? "",
        price: p.price ? Number(p.price) : "",
        stock: p.stock ?? "",
        status: p.status,
        category: p.category.name,
        createdAt: p.createdAt.toISOString(),
      }));
      const csv = toCsv(rows, [
        "productId",
        "name",
        "sku",
        "price",
        "stock",
        "status",
        "category",
        "createdAt",
      ]);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=products.csv");
      return res.send(csv);
    } catch (error: any) {
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
};

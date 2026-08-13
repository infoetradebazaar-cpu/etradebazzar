import { Request, Response } from "express";
import { productModel3dService } from "./product-model3d.service";
import { logger } from "../../utils/logger";

const CLIENT_ERRORS = [
  "Product not found",
  "3D model not found",
  "File too large",
  "File content does not match an allowed type",
];

function isClientError(message: string): boolean {
  return CLIENT_ERRORS.some((prefix) => message.startsWith(prefix));
}

export const productModel3dController = {
  async upload(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId } = req.params;
      const file = req.file as Express.Multer.File;
      if (!file) return res.status(400).json({ success: false, error: "File required" });
      const result = await productModel3dService.upload(sellerId, String(productId), file);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "3D model upload failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async get(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const result = await productModel3dService.get(String(productId));
      if (!result) return res.status(404).json({ success: false, error: "3D model not found" });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get 3D model failed");
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId } = req.params;
      const result = await productModel3dService.delete(sellerId, String(productId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete 3D model failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
};

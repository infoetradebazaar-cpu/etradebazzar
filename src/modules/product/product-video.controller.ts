import { Request, Response } from "express";
import { productVideoService } from "./product-video.service";
import { logger } from "../../utils/logger";

const CLIENT_ERRORS = [
  "Product not found",
  "Video not found",
  "File too large",
  "File content does not match an allowed type",
  "A video already exists",
];

function isClientError(message: string): boolean {
  return CLIENT_ERRORS.some((prefix) => message.startsWith(prefix));
}

export const productVideoController = {
  async upload(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId } = req.params;
      const file = req.file as Express.Multer.File;
      if (!file) return res.status(400).json({ success: false, error: "File required" });
      const result = await productVideoService.upload(sellerId, String(productId), file);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Video upload failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async get(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const result = await productVideoService.get(String(productId));
      if (!result) return res.status(404).json({ success: false, error: "Video not found" });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get video failed");
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId } = req.params;
      const result = await productVideoService.delete(sellerId, String(productId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete video failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
};

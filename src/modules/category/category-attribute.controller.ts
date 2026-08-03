import { Request, Response } from "express";
import { categoryAttributeService } from "./category-attribute.service";
import { logger } from "../../utils/logger";

const clientErrors = [
  "Category not found",
  "Attribute key already exists for this category",
  "Attribute not found",
  "Option not found",
  "Target option not found",
  "Option value already exists for this attribute",
  "Options can only be added to ENUM attributes",
  "Cannot approve a merged option",
  "Cannot reject a merged option",
  "Cannot merge an option into itself",
  "Cannot merge into an already-merged option",
  "Cannot delete an option that is in use",
];

function isClientError(message: string): boolean {
  return clientErrors.some((e) => message.startsWith(e));
}

export const categoryAttributeController = {
  async createAttribute(req: Request, res: Response) {
    try {
      const { categoryId } = req.params;
      const result = await categoryAttributeService.createAttribute(
        String(categoryId),
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create category attribute failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateAttribute(req: Request, res: Response) {
    try {
      const { categoryId, attributeId } = req.params;
      const result = await categoryAttributeService.updateAttribute(
        String(categoryId),
        String(attributeId),
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update category attribute failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deleteAttribute(req: Request, res: Response) {
    try {
      const { categoryId, attributeId } = req.params;
      await categoryAttributeService.deleteAttribute(
        String(categoryId),
        String(attributeId),
      );
      return res.json({ success: true, message: "Attribute deleted" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete category attribute failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listAttributes(req: Request, res: Response) {
    try {
      const { categoryId } = req.params;
      const result = await categoryAttributeService.listAttributes(String(categoryId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List category attributes failed");
      if (error.message === "Category not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  // --- Attribute options (variant values) ---

  async listOptions(req: Request, res: Response) {
    try {
      const { categoryId, attributeId } = req.params;
      const { status } = req.query as Record<string, string>;
      const result = await categoryAttributeService.listOptions(
        String(categoryId),
        String(attributeId),
        status as any,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List attribute options failed");
      if (isClientError(error.message)) {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async createOption(req: Request, res: Response) {
    try {
      const { categoryId, attributeId } = req.params;
      const result = await categoryAttributeService.createOption(
        String(categoryId),
        String(attributeId),
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create attribute option failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateOption(req: Request, res: Response) {
    try {
      const { categoryId, attributeId, optionId } = req.params;
      const result = await categoryAttributeService.updateOption(
        String(categoryId),
        String(attributeId),
        String(optionId),
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update attribute option failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async approveOption(req: Request, res: Response) {
    try {
      const { categoryId, attributeId, optionId } = req.params;
      const reviewerId = req.user!.id;
      const result = await categoryAttributeService.approveOption(
        String(categoryId),
        String(attributeId),
        String(optionId),
        reviewerId,
        req.body?.reviewNote,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Approve attribute option failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async rejectOption(req: Request, res: Response) {
    try {
      const { categoryId, attributeId, optionId } = req.params;
      const reviewerId = req.user!.id;
      const result = await categoryAttributeService.rejectOption(
        String(categoryId),
        String(attributeId),
        String(optionId),
        reviewerId,
        req.body?.reviewNote,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Reject attribute option failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async mergeOption(req: Request, res: Response) {
    try {
      const { categoryId, attributeId, optionId } = req.params;
      const reviewerId = req.user!.id;
      const { targetOptionId } = req.body;
      const result = await categoryAttributeService.mergeOption(
        String(categoryId),
        String(attributeId),
        String(optionId),
        String(targetOptionId),
        reviewerId,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Merge attribute option failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deleteOption(req: Request, res: Response) {
    try {
      const { categoryId, attributeId, optionId } = req.params;
      await categoryAttributeService.deleteOption(
        String(categoryId),
        String(attributeId),
        String(optionId),
      );
      return res.json({ success: true, message: "Option deleted" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete attribute option failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listPendingOptions(req: Request, res: Response) {
    try {
      const { page, limit } = req.query as Record<string, string>;
      const result = await categoryAttributeService.listPendingOptions({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List pending attribute options failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
};

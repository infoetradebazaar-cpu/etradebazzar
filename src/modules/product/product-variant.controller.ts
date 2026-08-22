import { Request, Response } from "express";
import { productVariantService } from "./product-variant.service";
import { logger } from "../../utils/logger";

const clientErrors = [
  "Product not found",
  "SKU not found",
  "SKU code already exists",
  "Variant option not found",
  'Variant option "',
  "Variant value not found",
  "Delete all SKUs before removing variant options",
  "Variant value is used by existing SKUs  delete SKUs first",
  "SKU is referenced by existing orders  cannot delete",
  "Product has no variant options defined",
  "A SKU with this option combination already exists",
  "All values already exist",
  "Variant attribute ",
  "Invalid variant value ",
  "Price tier not found",
  "This SKU already has a tier that starts at",
  "A tier at minQty=",
  "Tier range [",
  "Tier at minQty=",
  "Quantity ",
  "SkuPriceTier.minQty must be >= 2",
  "Tier price (",
  "Tier hidden floor price (",
  "Tier hidden floor (",
  "Cannot set SKU price (",
];

function isClientError(message: string): boolean {
  return clientErrors.some((e) => message.startsWith(e.split('"')[0]!));
}

export const productVariantController = {
  async createVariant(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId } = req.params;
      const result = await productVariantService.createVariant(
        sellerId,
        String(productId),
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create variant failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async addVariantValues(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, optionId } = req.params;
      const { values } = req.body;
      const result = await productVariantService.addVariantValues(
        sellerId,
        String(productId),
        String(optionId),
        values,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Add variant values failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deleteVariant(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, optionId } = req.params;
      await productVariantService.deleteVariant(
        sellerId,
        String(productId),
        String(optionId),
      );
      return res.json({ success: true, message: "Variant option deleted" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete variant failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deleteVariantValue(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, optionId, valueId } = req.params;
      await productVariantService.deleteVariantValue(
        sellerId,
        String(productId),
        String(optionId),
        String(valueId),
      );
      return res.json({ success: true, message: "Variant value deleted" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete variant value failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listVariants(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const result = await productVariantService.listVariants(
        String(productId),
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List variants failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async createSKU(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId } = req.params;
      const result = await productVariantService.createSKU(
        sellerId,
        String(productId),
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create SKU failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateSKU(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, skuId } = req.params;
      const result = await productVariantService.updateSKU(
        sellerId,
        String(productId),
        String(skuId),
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update SKU failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deleteSKU(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, skuId } = req.params;
      await productVariantService.deleteSKU(
        sellerId,
        String(productId),
        String(skuId),
      );
      return res.json({ success: true, message: "SKU deleted" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete SKU failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listSKUs(req: Request, res: Response) {
    try {
      const { productId } = req.params;
      const result = await productVariantService.listSKUs(String(productId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List SKUs failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getSKU(req: Request, res: Response) {
    try {
      const { productId, skuId } = req.params;
      const result = await productVariantService.getSKU(
        String(productId),
        String(skuId),
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get SKU failed");
      if (error.message === "SKU not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listPriceTiers(req: Request, res: Response) {
    try {
      const { productId, skuId } = req.params;
      const result = await productVariantService.listPriceTiers(String(productId), String(skuId));
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List price tiers failed");
      if (isClientError(error.message)) {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async listPriceTiersForSeller(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, skuId } = req.params;
      const result = await productVariantService.listPriceTiersForSeller(
        sellerId,
        String(productId),
        String(skuId),
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List price tiers (seller) failed");
      if (isClientError(error.message)) {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async createPriceTier(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, skuId } = req.params;
      const result = await productVariantService.createPriceTier(
        sellerId,
        String(productId),
        String(skuId),
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create price tier failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async updatePriceTier(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, skuId, tierId } = req.params;
      const result = await productVariantService.updatePriceTier(
        sellerId,
        String(productId),
        String(skuId),
        String(tierId),
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update price tier failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },

  async deletePriceTier(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { productId, skuId, tierId } = req.params;
      await productVariantService.deletePriceTier(
        sellerId,
        String(productId),
        String(skuId),
        String(tierId),
      );
      return res.json({ success: true, message: "Price tier deleted" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete price tier failed");
      if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
};
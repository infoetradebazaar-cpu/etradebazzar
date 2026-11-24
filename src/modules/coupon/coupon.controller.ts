import { Request, Response } from "express";
import { couponService } from "./coupon.service";
import { logger } from "../../utils/logger";
import { sendClientError } from "../../utils/http-error";

const clientErrors = [
  "Coupon code already exists",
  "Percentage discount cannot exceed 100%",
  "Cannot generate more than 1000 codes at once",
  "Invalid coupon code",
  "Coupon is not active",
  "Coupon has expired",
  "Coupon usage limit reached",
  "You have already used this coupon",
  "This coupon is for first-time buyers only",
  "Coupon not applicable for these products",
  "Coupon not applicable for these categories",
  "Coupon is being processed  try again in a moment",
  "Coupon not found",
];

function isClientError(msg: string): boolean {
  return clientErrors.some((e) => msg.startsWith(e));
}

export const couponController = {
  async createCoupon(req: Request, res: Response) {
    try {
      const actorId = req.user!.id;
      const result = await couponService.createCoupon(actorId, req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create coupon failed");
      if (isClientError(error.message))
        return sendClientError(res, error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async bulkGenerateCoupons(req: Request, res: Response) {
    try {
      const actorId = req.user!.id;
      const result = await couponService.bulkGenerateCoupons(actorId, req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Bulk generate coupons failed");
      if (isClientError(error.message))
        return sendClientError(res, error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async validateCoupon(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { code, orderAmount, productIds, categoryIds } = req.body;
      const result = await couponService.validateCoupon(
        code,
        userId,
        orderAmount,
        productIds,
        categoryIds,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Validate coupon failed");
      if (isClientError(error.message))
        return sendClientError(res, error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateCoupon(req: Request, res: Response) {
    try {
      const { couponId } = req.params;
      const result = await couponService.updateCoupon(
        couponId as string,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update coupon failed");
      if (isClientError(error.message))
        return sendClientError(res, error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deactivateCoupon(req: Request, res: Response) {
    try {
      const { couponId } = req.params;
      const actorId = req.user!.id;
      const result = await couponService.deactivateCoupon(
        couponId as string,
        actorId,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Deactivate coupon failed");
      if (isClientError(error.message))
        return sendClientError(res, error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listCoupons(req: Request, res: Response) {
    try {
      const { isActive, scopeType } = req.query as Record<string, string>;
      const result = await couponService.listCoupons({
        isActive: isActive !== undefined ? isActive === "true" : undefined,
        scopeType,
      });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List coupons failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getCoupon(req: Request, res: Response) {
    try {
      const { couponId } = req.params;
      const result = await couponService.getCoupon(couponId as string);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get coupon failed");
      if (error.message === "Coupon not found")
        return sendClientError(res, error, 404);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
};

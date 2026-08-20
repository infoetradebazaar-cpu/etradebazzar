import { Request, Response, NextFunction } from "express";
import { db } from "../db/index";
import { logger } from "../utils/logger";
import { canAccessOrgResource } from "../lib/permission/customer-org-permission.service";
import { CUSTOMER_ORG_PERMISSIONS } from "../lib/permission/customer-org-permission.constants";

export const verifyOrderAccess = async (req: Request, res: Response, next: NextFunction) => {
    const { orderId } = req.params;

    if (!orderId) {
        return res.status(400).json({ success: false, error: "Order ID required" });
    }

    try {
        const order = await db.order.findUnique({
            where: { id: orderId },
            select: { customerId: true, sellerId: true, orgId: true },
        });

        const isCustomer =
            !!order &&
            (order.customerId === req.user?.id ||
                (await canAccessOrgResource(
                    req.user?.id,
                    order.orgId,
                    CUSTOMER_ORG_PERMISSIONS.VIEW_ORDER_HISTORY,
                )));
        const isOwningSeller = !!order && req.seller?.id === order.sellerId;

        if (!order || (!isCustomer && !isOwningSeller)) {
            return res.status(404).json({ success: false, error: "Order not found" });
        }

        next();
    } catch (error: any) {
        logger.error({ err: error.message, orderId }, "Order access check failed");
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
};
import { Request, Response } from "express";
import { paymentService } from "./payment.service";
import { logger } from "../../utils/logger";

export const paymentController = {
    async createAdvancePayment(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await paymentService.createAdvancePayment(orderId as string);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Create advance payment failed");
            const clientErrors = [
                "Order not found",
                "Order not in payable state",
                "Advance payment already initiated",
                "Payment initiation already in progress, please wait",
                "Online payments are currently disabled - use manual/cash payment recording instead",
            ];
            if (clientErrors.includes(error.message)) {
                return res.status(409).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async createFinalPayment(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await paymentService.createFinalPayment(orderId as string);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Create final payment failed");
            const clientErrors = [
                "Order not found",
                "Advance payment not completed",
                "Final payment already initiated",
                "Online payments are currently disabled - use manual/cash payment recording instead",
            ];
            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async verifyPayment(req: Request, res: Response) {
        try {
            const result = await paymentService.verifyAndCapturePayment(req.body, {
                userId: req.user?.id,
                sellerId: req.seller?.id,
            });
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Verify payment failed");
            if (error.message === "Invalid payment signature") {
                return res.status(400).json({ success: false, error: error.message });
            }
            if (error.message === "Order not found" || error.message === "Payment does not belong to this order") {
                return res.status(404).json({ success: false, error: "Order not found" });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async webhook(req: Request, res: Response) {
        try {
            const signature = req.headers["x-razorpay-signature"] as string;
            if (!signature) {
                return res.status(400).json({ error: "Missing signature" });
            }
            const result = await paymentService.handleWebhook(req.body, signature);
            return res.json(result);
        } catch (error: any) {
            logger.error({ err: error.message }, "Webhook failed");
            if (error.message === "Invalid webhook signature") {
                return res.status(400).json({ error: error.message });
            }
            return res.status(500).json({ error: "Internal server error" });
        }
    },

    async initiateRefund(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const actorId = req.user!.id;
            const result = await paymentService.initiateRefund(orderId as string, actorId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Refund failed");
            const clientErrors = [
                "Order not found",
                "Order must be cancelled first",
                "No payments to refund",
            ];
            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getPayments(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const result = await paymentService.getPayments(orderId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get payments failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async recordManualPayment(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const actorId = req.user!.id;
            const result = await paymentService.recordManualPayment(orderId as string, actorId, req.body);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Record manual payment failed");
            const clientErrors = [
                "Order not found",
                "Order not in payable state",
                "Advance payment already initiated",
                "Advance payment not completed",
                "Final payment already initiated",
            ];
            if (clientErrors.includes(error.message)) {
                return res.status(409).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getOnlinePaymentsEnabled(req: Request, res: Response) {
        try {
            const enabled = await paymentService.getOnlinePaymentsEnabled();
            return res.json({ success: true, data: { enabled } });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get online payments flag failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async setOnlinePaymentsEnabled(req: Request, res: Response) {
        try {
            const actorId = req.user!.id;
            const { enabled } = req.body;
            const result = await paymentService.setOnlinePaymentsEnabled(Boolean(enabled), actorId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Set online payments flag failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
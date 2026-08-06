import { Request, Response } from "express";
import { shipmentService } from "./shipment.service";
import { logger } from "../../utils/logger";
import { toCsv } from "../../utils/csv";
import { db } from "../../db/index";

export const shipmentController = {
    async trackShipment(req: Request, res: Response) {
        try {
            const { shipmentId } = req.params;
            let result;
            if (req.seller?.id) {
                result = await shipmentService.trackShipment(req.seller.id, String(shipmentId));
            } else {
                const platformMember = await db.platformMember.findUnique({
                    where: { userId: req.user!.id },
                    select: { id: true },
                });
                if (platformMember) {
                    result = await shipmentService.trackShipmentAsAdmin(String(shipmentId));
                } else {
                    result = await shipmentService.trackShipmentAsCustomer(req.user!.id, String(shipmentId));
                }
            }
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Track shipment failed");
            const clientErrors = ["Shipment not found", "No tracking ID available yet"];
            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async cancelShipment(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { shipmentId } = req.params;
            const actorId = req.user!.id;
            const result = await shipmentService.cancelShipment(sellerId, String(shipmentId), actorId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Cancel shipment failed");
            const clientErrors = ["Shipment not found", "Cannot cancel delivered shipment"];
            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async checkServiceability(req: Request, res: Response) {
        try {
            const { pickupPincode, deliveryPincode, weightKg, cod } = req.query as Record<string, string>;
            if (!pickupPincode || !deliveryPincode || !weightKg) {
                return res.status(400).json({ success: false, error: "pickupPincode, deliveryPincode, weightKg required" });
            }
            const result = await shipmentService.checkServiceability(
                pickupPincode,
                deliveryPincode,
                Number(weightKg),
                cod === "true"
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Check serviceability failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listShipments(req: Request, res: Response) {
        try {
            const { status, search, sellerId, shopId, courierPartner, dateFrom, dateTo, page, limit } = req.query as Record<string, string>;
            const result = await shipmentService.listShipments({
                sellerId, status, search, shopId, courierPartner, dateFrom, dateTo,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "List shipments failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getShipment(req: Request, res: Response) {
        try {
            const { shipmentId } = req.params;
            const result = await shipmentService.getShipment(String(shipmentId));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get shipment failed");
            if (error.message === "Shipment not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async handleWebhook(req: Request, res: Response) {
        try {
            const signature = req.headers["x-shiprocket-signature"] as string;
            if (!signature) {
                return res.status(400).json({ error: "Missing signature" });
            }
            const result = await shipmentService.handleWebhook(req.body, signature);
            return res.json(result);
        } catch (error: any) {
            logger.error({ err: error.message }, "Shipment webhook failed");
            if (error.message === "Invalid webhook signature") {
                return res.status(400).json({ error: error.message });
            }
            return res.status(500).json({ error: "Internal server error" });
        }
    },

    async getShipmentWithOrder(req: Request, res: Response) {
        try {
            const { shipmentId } = req.params;
            const result = await shipmentService.getShipmentWithOrder(String(shipmentId));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get shipment with order failed");
            if (error.message === "Shipment not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listShipmentsWithOrders(req: Request, res: Response) {
        try {
            const { sellerId } = req.query as Record<string, string>;
            const result = await shipmentService.listShipmentsWithOrders(sellerId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "List shipments with orders failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
    async bulkCancel(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const actorId = req.user!.id;
            const { shipmentIds } = req.body;
            const result = await shipmentService.bulkCancel(sellerId, actorId, shipmentIds);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Bulk cancel shipments failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
    async exportShipmentsCsv(req: Request, res: Response) {
        try {
            const { sellerId } = req.query as Record<string, string>;
            const shipments = await shipmentService.exportShipmentsCsv(sellerId);

            const rows = shipments.map(s => ({
                shipmentId: s.displayId ?? s.id, orderId: s.order.displayId ?? "",
                status: s.status, courier: s.provider, awb: s.trackingId ?? "",
                createdAt: s.createdAt.toISOString(),
            }));
            const csv = toCsv(rows, ["shipmentId", "orderId", "status", "courier", "awb", "createdAt"]);

            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", "attachment; filename=shipments.csv");
            return res.send(csv);
        } catch (error: any) {
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
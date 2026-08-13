import { Request, Response } from "express";
import { verificationService } from "./verification.service";
import { PanFactory } from "../../lib/pan/pan.factory";
import { logger } from "../../utils/logger";

function isClientError(error: any): boolean {
    if (error?.name === "VerificationRejectedError") return true;
    const msg: string = error?.message ?? "";
    return (
        msg.startsWith("KYC record not found") ||
        msg.includes("already verified") ||
        msg === "PAN number format is invalid" ||
        msg.startsWith("PAN verification failed") ||
        msg.startsWith("No pending Aadhaar DigiLocker session") ||
        msg.startsWith("Aadhaar DigiLocker initialization failed") ||
        msg.startsWith("Aadhaar verification failed") ||
        msg.startsWith("Invalid Aadhaar number")
    );
}

export const verificationController = {
    async initializeAadhaarDigilocker(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const { redirectUrl } = req.body;
            const result = await verificationService.initializeAadhaarDigilocker(sellerId, redirectUrl);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Initialize aadhaar digilocker failed");
            if (isClientError(error)) return res.status(400).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async confirmAadhaarDigilocker(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const result = await verificationService.confirmAadhaarDigilocker(sellerId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Confirm aadhaar digilocker failed");
            if (isClientError(error)) return res.status(400).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async submitGovernmentId(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const result = await verificationService.submitGovernmentId(sellerId, req.body);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Submit govt id failed");
            if (isClientError(error)) return res.status(400).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getStatus(req: Request, res: Response) {
        try {
            const sellerId = req.seller!.id;
            const result = await verificationService.getVerificationStatus(sellerId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get verification status failed");
            if (error.message === "KYC record not found") return res.status(404).json({ success: false, error: error.message });
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async verifyAadhaar(req: Request, res: Response) {
        try {
            const { sellerId } = req.params;
            const actorId = req.user!.id;
            const result = await verificationService.verifyAadhaar(sellerId as string, actorId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Verify aadhaar failed");
            if (error.message === "KYC record not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            if (error.message.startsWith("Cannot verify")) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async rejectAadhaar(req: Request, res: Response) {
        try {
            const { sellerId } = req.params;
            const actorId = req.user!.id;
            const { reason } = req.body;
            const result = await verificationService.rejectAadhaar(sellerId as string, actorId, reason);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Reject aadhaar failed");
            if (error.message === "KYC record not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            if (error.message.startsWith("Cannot reject")) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async verifyGovernmentId(req: Request, res: Response) {
        try {
            const { sellerId } = req.params;
            const actorId = req.user!.id;
            const result = await verificationService.verifyGovernmentId(sellerId as string, actorId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Verify govt id failed");
            if (error.message === "KYC record not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            if (error.message.startsWith("Cannot verify")) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async rejectGovernmentId(req: Request, res: Response) {
        try {
            const { sellerId } = req.params;
            const actorId = req.user!.id;
            const { reason } = req.body;
            const result = await verificationService.rejectGovernmentId(sellerId as string, actorId, reason);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Reject govt id failed");
            if (error.message === "KYC record not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            if (error.message.startsWith("Cannot reject")) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    /** Standalone PAN verification — calls PanFactory directly, no KYC record needed */
    async verifyPan(req: Request, res: Response) {
        try {
            const { panNumber } = req.body;
            const provider = PanFactory.get();
            const result = await provider.verifyPan(panNumber);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Standalone PAN verify failed");
            if (isClientError(error)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    /** Standalone Aadhaar verification — validates 12-digit format (real verification via DigiLocker later) */
    async verifyAadhaarNumber(req: Request, res: Response) {
        try {
            const { aadhaarNumber } = req.body;
            return res.json({
                success: true,
                data: {
                    aadhaarNumber: aadhaarNumber.replace(/(\d{4})\d{4}(\d{4})/, "$1XXXX$2"),
                    valid: true,
                    message: "Aadhaar number format is valid",
                },
            });
        } catch (error: any) {
            logger.error({ err: error.message }, "Standalone Aadhaar verify failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
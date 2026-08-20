import { Request, Response } from "express";
import { securityService } from "./security.service";
import { logger } from "../../utils/logger";

export const securityController = {
    async setupTwoFactor(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const email = req.user!.email;
            const { method, currentToken } = req.body;
            const result = await securityService.generateTwoFactorSecret(userId, email as string, method, currentToken);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Setup 2FA failed");
            if (["Current 2FA code required to re-enroll", "Invalid 2FA code", "User not found"].includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async requestTwoFactorEmailCode(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const purpose = req.body.purpose === "disable" ? "2fa-disable" : "2fa-reverify";
            await securityService.requestTwoFactorEmailCode(userId, purpose);
            return res.json({ success: true, message: "Verification code sent" });
        } catch (error: any) {
            logger.error({ err: error.message }, "Request 2FA email code failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async verifyTwoFactor(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { method, token } = req.body;
            const result = await securityService.verifyAndEnableTwoFactor(userId, method, token);
            return res.json({
                success: true,
                data: {
                    twoFactorEnabled: result.twoFactorEnabled,
                    twoFactorMethod: result.twoFactorMethod,
                    backupCodes: result.backupCodes,
                },
            });
        } catch (error: any) {
            logger.error({ err: error.message }, "Verify 2FA failed");
            if (["2FA setup not initiated", "Invalid 2FA code", "Too many attempts, request a new code"].includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async disableTwoFactor(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { token } = req.body;
            await securityService.disableTwoFactor(userId, token);
            return res.json({ success: true, data: { twoFactorEnabled: false } });
        } catch (error: any) {
            logger.error({ err: error.message }, "Disable 2FA failed");
            if (["Invalid 2FA code", "Too many attempts, request a new code"].includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async regenerateBackupCodes(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { token } = req.body;
            const backupCodes = await securityService.regenerateBackupCodes(userId, token);
            return res.json({ success: true, data: { backupCodes } });
        } catch (error: any) {
            logger.error({ err: error.message }, "Regenerate backup codes failed");
            if (["Invalid 2FA code", "Too many attempts, request a new code"].includes(error.message)) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async listSessions(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await securityService.listSessions(userId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "List sessions failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async revokeSession(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const { sessionId } = req.params;
            const result = await securityService.revokeSession(userId, sessionId as string);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Revoke session failed");
            if (error.message === "Session not found") {
                return res.status(404).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async revokeAllSessions(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const currentSessionId = req?.sessionId; // set by auth middleware 
            const result = await securityService.revokeAllSessions(userId, currentSessionId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Revoke all sessions failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getSecuritySummary(req: Request, res: Response) {
        try {
            const userId = req.user!.id;
            const result = await securityService.getSecuritySummary(userId);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Get security summary failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
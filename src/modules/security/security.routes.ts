import { Router } from "express";
import { securityController } from "./security.controller";
import { protect } from "../../middleware/auth";
import { validate } from "../../utils/validate";
import { sellerLimiter, twoFactorLimiter } from "../../middleware/rate-limit";
import {
    setupTwoFactorSchema,
    verifyTwoFactorSetupSchema,
    verifyTwoFactorSchema,
    requestTwoFactorEmailCodeSchema,
    sessionParamSchema,
} from "./security.schema";

const router = Router();

router.get("/summary", protect, sellerLimiter, securityController.getSecuritySummary);

router.post("/2fa/setup", protect, twoFactorLimiter, validate(setupTwoFactorSchema), securityController.setupTwoFactor);
router.post("/2fa/request-code", protect, twoFactorLimiter, validate(requestTwoFactorEmailCodeSchema), securityController.requestTwoFactorEmailCode);
router.post("/2fa/verify", protect, twoFactorLimiter, validate(verifyTwoFactorSetupSchema), securityController.verifyTwoFactor);
router.post("/2fa/disable", protect, twoFactorLimiter, validate(verifyTwoFactorSchema), securityController.disableTwoFactor);
router.post("/2fa/backup-codes/regenerate", protect, twoFactorLimiter, validate(verifyTwoFactorSchema), securityController.regenerateBackupCodes);

router.get("/sessions", protect, sellerLimiter, securityController.listSessions);
router.delete("/sessions/:sessionId", protect, sellerLimiter, validate(sessionParamSchema), securityController.revokeSession);
router.post("/sessions/revoke-all", protect, sellerLimiter, securityController.revokeAllSessions);

export default router;
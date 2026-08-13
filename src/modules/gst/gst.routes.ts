import { Router } from "express";
import { gstController } from "./gst.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permission";
import { PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import { verifyGstSchema } from "./gst.schema";

const router = Router();

router.post("/verify", protect, sellerLimiter, validate(verifyGstSchema), gstController.verifyGst);
router.post("/verify-autofill", protect, sellerLimiter, resolveTenant, requirePermission(PERMISSIONS.SELLER_GST_MANAGE),
    validate(verifyGstSchema), gstController.verifyAndAutofill);

export default router;
import { Router } from "express";
import { customerController } from "./customer.controller";
import { protect } from "../../middleware/auth";
import { validate } from "../../utils/validate";
import { publicLimiter, sellerLimiter, otpLimiter } from "../../middleware/rate-limit";
import {
  registerCustomerSchema,
  updateProfileSchema,
  listMyOrdersSchema,
  phoneLinkRequestSchema,
  phoneLinkVerifySchema,
} from "./customer.schema";

const router = Router();

router.post("/register", publicLimiter, validate(registerCustomerSchema), customerController.register);
router.get("/profile", protect, sellerLimiter, customerController.getProfile);
router.put("/profile", protect, sellerLimiter, validate(updateProfileSchema), customerController.updateProfile);
router.post("/phone/link-request", protect, otpLimiter, validate(phoneLinkRequestSchema), customerController.requestPhoneLink);
router.post("/phone/link-verify", protect, otpLimiter, validate(phoneLinkVerifySchema), customerController.verifyPhoneLink);
router.get("/orders", protect, sellerLimiter, validate(listMyOrdersSchema), customerController.listMyOrders);

export default router;
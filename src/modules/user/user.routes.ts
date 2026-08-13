import { Router } from "express";
import { userController } from "./user.controller";
import { protect } from "../../middleware/auth";
import { requirePlatformAdminAndPermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { sellerLimiter } from "../../middleware/rate-limit";

const router = Router();

router.get(
  "/",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_USERS_VIEW]),
  userController.listUsers,
);

export default router;

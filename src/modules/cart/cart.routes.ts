import { Router } from "express";
import { cartController } from "./cart.controller";
import { protect } from "../../middleware/auth";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import { requireCustomerOrgPermissionIfOrg } from "../../middleware/permission";
import { CUSTOMER_ORG_PERMISSIONS } from "../../lib/permission/customer-org-permission.constants";
import { addCartItemSchema, updateCartItemSchema, cartItemParamSchema, checkoutSchema } from "./cart.schema";

const router = Router();

router.get("/", protect, sellerLimiter, requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.VIEW_ORG_CART), cartController.getCart);
router.post("/items", protect, sellerLimiter, requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.EDIT_ORG_CART), validate(addCartItemSchema), cartController.addItem);
router.patch("/items/:itemId", protect, sellerLimiter, requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.EDIT_ORG_CART), validate(updateCartItemSchema), cartController.updateItem);
router.delete("/items/:itemId", protect, sellerLimiter, requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.EDIT_ORG_CART), validate(cartItemParamSchema), cartController.removeItem);
router.delete("/", protect, sellerLimiter, requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.EDIT_ORG_CART), cartController.clearCart);
router.post("/checkout", protect, sellerLimiter, requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.PLACE_ORDER), validate(checkoutSchema), cartController.checkout);

export default router;
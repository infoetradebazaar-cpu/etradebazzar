import { Router } from "express";
import { customizationOptionController } from "./customization-option.controller";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePermission } from "../../middleware/permission";
import { PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { publicLimiter, sellerLimiter } from "../../middleware/rate-limit";
import {
    productParamSchema, groupParamSchema, optionParamSchema,
    createGroupSchema, updateGroupSchema, createOptionSchema, updateOptionSchema,
} from "./customization-option.schema";

const router = Router();

// Public - buyers need the catalog to render the customization form
router.get("/product/:productId", publicLimiter, validate(productParamSchema), customizationOptionController.listForProduct);

// Seller - option groups
router.post("/product/:productId/groups", protect, sellerLimiter, resolveTenant,
    requirePermission(PERMISSIONS.CUSTOMIZATION_MANAGE), validate(createGroupSchema),
    customizationOptionController.createGroup);
router.patch("/product/:productId/groups/:groupId", protect, sellerLimiter, resolveTenant,
    requirePermission(PERMISSIONS.CUSTOMIZATION_MANAGE), validate(updateGroupSchema),
    customizationOptionController.updateGroup);
router.delete("/product/:productId/groups/:groupId", protect, sellerLimiter, resolveTenant,
    requirePermission(PERMISSIONS.CUSTOMIZATION_MANAGE), validate(groupParamSchema),
    customizationOptionController.deleteGroup);

// Seller - options within a group
router.post("/product/:productId/groups/:groupId/options", protect, sellerLimiter, resolveTenant,
    requirePermission(PERMISSIONS.CUSTOMIZATION_MANAGE), validate(createOptionSchema),
    customizationOptionController.createOption);
router.patch("/product/:productId/groups/:groupId/options/:optionId", protect, sellerLimiter, resolveTenant,
    requirePermission(PERMISSIONS.CUSTOMIZATION_MANAGE), validate(updateOptionSchema),
    customizationOptionController.updateOption);
router.delete("/product/:productId/groups/:groupId/options/:optionId", protect, sellerLimiter, resolveTenant,
    requirePermission(PERMISSIONS.CUSTOMIZATION_MANAGE), validate(optionParamSchema),
    customizationOptionController.deleteOption);

export default router;

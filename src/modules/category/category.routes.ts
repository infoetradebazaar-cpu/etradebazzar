import { Router } from "express";
import { categoryController } from "./category.controller";
import { categoryAttributeController } from "./category-attribute.controller";
import { protect } from "../../middleware/auth";
import { requirePlatformAdminAndPermission } from "../../middleware/permission";
import { PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import { sellerLimiter, publicLimiter } from "../../middleware/rate-limit";
import {
  createCategorySchema,
  updateCategorySchema,
  categoryParamSchema,
  listCategoriesSchema,
} from "./category.schema";
import {
  createCategoryAttributeSchema,
  updateCategoryAttributeSchema,
  categoryAttributeParamSchema,
  listCategoryAttributesSchema,
  listAttributeOptionsSchema,
  createAttributeOptionSchema,
  updateAttributeOptionSchema,
  attributeOptionParamSchema,
  reviewAttributeOptionSchema,
  mergeAttributeOptionSchema,
  listPendingAttributeOptionsSchema,
} from "./category-attribute.schema";

const router = Router();

// sellers + customers
router.get(
  "/",
  publicLimiter,
  validate(listCategoriesSchema),
  categoryController.listCategories,
);

router.get("/tree", publicLimiter, categoryController.getCategoryTree);

router.get(
  "/attributes/options/pending",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(listPendingAttributeOptionsSchema),
  categoryAttributeController.listPendingOptions,
);

router.get(
  "/:categoryId",
  publicLimiter,
  validate(categoryParamSchema),
  categoryController.getCategory,
);

// Platform admin only  manage categories
router.post(
  "/",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(createCategorySchema),
  categoryController.createCategory,
);

router.patch(
  "/:categoryId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(updateCategorySchema),
  categoryController.updateCategory,
);

router.delete(
  "/:categoryId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(categoryParamSchema),
  categoryController.deleteCategory,
);

router.get(
  "/:categoryId/attributes",
  publicLimiter,
  validate(listCategoryAttributesSchema),
  categoryAttributeController.listAttributes,
);

router.post(
  "/:categoryId/attributes",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(createCategoryAttributeSchema),
  categoryAttributeController.createAttribute,
);

router.patch(
  "/:categoryId/attributes/:attributeId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(updateCategoryAttributeSchema),
  categoryAttributeController.updateAttribute,
);

router.delete(
  "/:categoryId/attributes/:attributeId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(categoryAttributeParamSchema),
  categoryAttributeController.deleteAttribute,
);

// Platform admin  attribute option (variant value) catalog + moderation
router.get(
  "/:categoryId/attributes/:attributeId/options",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(listAttributeOptionsSchema),
  categoryAttributeController.listOptions,
);

router.post(
  "/:categoryId/attributes/:attributeId/options",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(createAttributeOptionSchema),
  categoryAttributeController.createOption,
);

router.patch(
  "/:categoryId/attributes/:attributeId/options/:optionId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(updateAttributeOptionSchema),
  categoryAttributeController.updateOption,
);

router.post(
  "/:categoryId/attributes/:attributeId/options/:optionId/approve",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(reviewAttributeOptionSchema),
  categoryAttributeController.approveOption,
);

router.post(
  "/:categoryId/attributes/:attributeId/options/:optionId/reject",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(reviewAttributeOptionSchema),
  categoryAttributeController.rejectOption,
);

router.post(
  "/:categoryId/attributes/:attributeId/options/:optionId/merge",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(mergeAttributeOptionSchema),
  categoryAttributeController.mergeOption,
);

router.delete(
  "/:categoryId/attributes/:attributeId/options/:optionId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin"], [PLATFORM_PERMISSIONS.PLATFORM_CATEGORIES_MANAGE]),
  validate(attributeOptionParamSchema),
  categoryAttributeController.deleteOption,
);

export default router;

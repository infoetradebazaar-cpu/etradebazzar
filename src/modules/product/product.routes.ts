import { Router } from "express";
import multer from "multer";
import { productController } from "./product.controller";
import { productImageController } from "./product-image.controller";
import { productVariantController } from "./product-variant.controller";
import { productSearchController } from "./product-search.controller";
import { productBulkController } from "./product-bulk.controller";
import { commissionNegotiationController } from "./commission-negotiation.controller";
import { productModel3dController } from "./product-model3d.controller";
import { productModel3DParamSchema } from "./product-model3d.schema";
import { productVideoController } from "./product-video.controller";
import { productVideoParamSchema } from "./product-video.schema";
import { protect } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { requirePermission, requirePlatformAdminAndPermission } from "../../middleware/permission";
import { PERMISSIONS, PLATFORM_PERMISSIONS } from "../../lib/permission/permission.constants";
import { validate } from "../../utils/validate";
import {
  sellerLimiter,
  uploadLimiter,
  publicLimiter,
  searchLimiter,
} from "../../middleware/rate-limit";
import {
  createProductSchema,
  updateProductSchema,
  productParamSchema,
  reviewProductSchema,
  rejectProductSchema,
  listProductsSchema,
  bulkProductActionSchema,
  submitForReviewSchema,
  createProductCompleteSchema,
} from "./product.schema";
import {
  productImageParamSchema,
  deleteImageSchema,
  reorderImagesSchema,
  uploadImageSchema,
} from "./product-image.schema";
import {
  createVariantSchema,
  addVariantValuesSchema,
  variantParamSchema,
  variantValueParamSchema,
  createSKUSchema,
  updateSKUSchema,
  skuParamSchema,
  createPriceTierSchema,
  updatePriceTierSchema,
  priceTierParamSchema,
} from "./product-variant.schema";
import { searchProductsSchema, facetsQuerySchema } from "./product-search.schema";
import {
  proposeCommissionSchema,
  respondCommissionProposalSchema,
  listCommissionProposalsSchema,
} from "./commission-negotiation.schema";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const upload3d = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.get(
  "/search",
  searchLimiter,
  validate(searchProductsSchema),
  productSearchController.searchProducts,
);
router.get(
  "/search/facets",
  searchLimiter,
  validate(facetsQuerySchema),
  productSearchController.getFacets,
);
router.get(
  "/bulk/template",
  publicLimiter,
  productBulkController.downloadTemplate,
);
router.post(
  "/bulk",
  protect,
  uploadLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_BULK),
  upload.single("file"),
  productBulkController.uploadProducts,
);
router.get(
  "/pending",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_VIEW]),
  productController.listPendingProducts,
);
router.get(
  "/all",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_VIEW]),
  productController.listAllProducts,
);
router.get(
  "/export",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_EXPORT),
  productController.exportProductsCsv,
);

router.get(
  "/commission-proposals/pending",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_VIEW]),
  commissionNegotiationController.listPendingForAdmin,
);
router.get(
  "/details/:productId",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_VIEW]),
  validate(productParamSchema),
  productController.getProductById,
);
router.get(
  "/search/reconcile",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_VIEW]),
  productSearchController.reconcileIndex,
);

// Platform Admin
router.patch(
  "/:productId/approve",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_APPROVE]),
  validate(reviewProductSchema),
  productController.approveProduct,
);
router.patch(
  "/:productId/reject",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_REJECT]),
  validate(rejectProductSchema),
  productController.rejectProduct,
);
router.post(
  "/:productId/commission-proposals/admin",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_SET_COMMISSION]),
  validate(proposeCommissionSchema),
  commissionNegotiationController.proposeAsAdmin,
);
router.patch(
  "/:productId/commission-proposals/:proposalId/respond/admin",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_SET_COMMISSION]),
  validate(respondCommissionProposalSchema),
  commissionNegotiationController.respondAsAdmin,
);
router.get(
  "/:productId/commission-proposals/admin",
  protect,
  sellerLimiter,
  requirePlatformAdminAndPermission(["super_admin", "product_reviewer"], [PLATFORM_PERMISSIONS.PLATFORM_PRODUCTS_VIEW]),
  validate(listCommissionProposalsSchema),
  commissionNegotiationController.listAsAdmin,
);

// Public: Product detail (for customers)
router.get(
  "/:productId/detail",
  publicLimiter,
  validate(productParamSchema),
  productController.getProductById,
);

// Seller: Product CRUD
router.post(
  "/",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_CREATE),
  validate(createProductSchema),
  productController.createProduct,
);
router.post(
  "/complete",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_CREATE),
  validate(createProductCompleteSchema),
  productController.createProductComplete,
);
router.get(
  "/",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VIEW),
  validate(listProductsSchema),
  productController.listProducts,
);
router.get(
  "/:productId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VIEW),
  validate(productParamSchema),
  productController.getProduct,
);
router.patch(
  "/:productId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_UPDATE),
  validate(updateProductSchema),
  productController.updateProduct,
);
router.patch(
  "/:productId/submit-for-review",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_UPDATE),
  validate(submitForReviewSchema),
  productController.submitForReview,
);
router.post(
  "/:productId/commission-proposals",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_UPDATE),
  validate(proposeCommissionSchema),
  commissionNegotiationController.proposeAsSeller,
);
router.patch(
  "/:productId/commission-proposals/:proposalId/respond",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_UPDATE),
  validate(respondCommissionProposalSchema),
  commissionNegotiationController.respondAsSeller,
);
router.get(
  "/:productId/commission-proposals",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VIEW),
  validate(listCommissionProposalsSchema),
  commissionNegotiationController.listAsSeller,
);
router.delete(
  "/:productId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_DELETE),
  validate(productParamSchema),
  productController.deleteProduct,
);
router.post(
  "/bulk-action",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_BULK),
  validate(bulkProductActionSchema),
  productController.bulkAction,
);

// Product Images
router.get(
  "/:productId/images",
  publicLimiter,
  validate(productImageParamSchema),
  productImageController.listImages,
);
router.post(
  "/:productId/images",
  protect,
  uploadLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_IMAGES),
  upload.single("image"),
  validate(uploadImageSchema),
  productImageController.uploadImage,
);
router.patch(
  "/:productId/images/reorder",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_IMAGES),
  validate(reorderImagesSchema),
  productImageController.reorderImages,
);
router.delete(
  "/:productId/images/:imageId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_IMAGES),
  validate(deleteImageSchema),
  productImageController.deleteImage,
);

// Product 3D Model
router.get(
  "/:productId/model3d",
  publicLimiter,
  validate(productModel3DParamSchema),
  productModel3dController.get,
);
router.post(
  "/:productId/model3d",
  protect,
  uploadLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_IMAGES),
  upload3d.single("file"),
  validate(productModel3DParamSchema),
  productModel3dController.upload,
);
router.delete(
  "/:productId/model3d",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_IMAGES),
  validate(productModel3DParamSchema),
  productModel3dController.delete,
);

// Product Video
router.get(
  "/:productId/video",
  publicLimiter,
  validate(productVideoParamSchema),
  productVideoController.get,
);
router.post(
  "/:productId/video",
  protect,
  uploadLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_IMAGES),
  uploadVideo.single("file"),
  validate(productVideoParamSchema),
  productVideoController.upload,
);
router.delete(
  "/:productId/video",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_IMAGES),
  validate(productVideoParamSchema),
  productVideoController.delete,
);

// Product Variants
router.get(
  "/:productId/variants",
  publicLimiter,
  validate(productImageParamSchema),
  productVariantController.listVariants,
);
router.post(
  "/:productId/variants",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(createVariantSchema),
  productVariantController.createVariant,
);
router.post(
  "/:productId/variants/:optionId/values",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(addVariantValuesSchema),
  productVariantController.addVariantValues,
);
router.delete(
  "/:productId/variants/:optionId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(variantParamSchema),
  productVariantController.deleteVariant,
);
router.delete(
  "/:productId/variants/:optionId/values/:valueId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(variantValueParamSchema),
  productVariantController.deleteVariantValue,
);

// Product SKUs
router.get(
  "/:productId/skus",
  publicLimiter,
  validate(productImageParamSchema),
  productVariantController.listSKUs,
);
router.get(
  "/:productId/skus/:skuId",
  publicLimiter,
  validate(skuParamSchema),
  productVariantController.getSKU,
);
router.post(
  "/:productId/skus",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(createSKUSchema),
  productVariantController.createSKU,
);
router.patch(
  "/:productId/skus/:skuId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(updateSKUSchema),
  productVariantController.updateSKU,
);
router.delete(
  "/:productId/skus/:skuId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(skuParamSchema),
  productVariantController.deleteSKU,
);

// SKU Price Tiers
router.get(
  "/:productId/skus/:skuId/tiers",
  publicLimiter,
  validate(skuParamSchema),
  productVariantController.listPriceTiers,
);
router.get(
  "/:productId/skus/:skuId/tiers/seller",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(skuParamSchema),
  productVariantController.listPriceTiersForSeller,
);
router.post(
  "/:productId/skus/:skuId/tiers",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(createPriceTierSchema),
  productVariantController.createPriceTier,
);
router.patch(
  "/:productId/skus/:skuId/tiers/:tierId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(updatePriceTierSchema),
  productVariantController.updatePriceTier,
);
router.delete(
  "/:productId/skus/:skuId/tiers/:tierId",
  protect,
  sellerLimiter,
  resolveTenant,
  requirePermission(PERMISSIONS.PRODUCTS_VARIANTS),
  validate(priceTierParamSchema),
  productVariantController.deletePriceTier,
);

export default router;

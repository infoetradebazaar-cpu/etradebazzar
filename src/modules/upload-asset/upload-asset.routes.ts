import { Router } from "express";
import multer from "multer";
import { uploadAssetController } from "./upload-asset.controller";
import { protect } from "../../middleware/auth";
import { validate } from "../../utils/validate";
import { uploadLimiter, sellerLimiter } from "../../middleware/rate-limit";
import { listRecentSchema, assetParamSchema } from "./upload-asset.schema";

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});
router.post("/", protect, uploadLimiter, upload.single("file"), uploadAssetController.uploadAsset);
router.get("/", protect, sellerLimiter, validate(listRecentSchema), uploadAssetController.listRecent);
router.delete("/:assetId", protect, sellerLimiter, validate(assetParamSchema), uploadAssetController.deleteAsset);

export default router;
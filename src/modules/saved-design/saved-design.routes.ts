import { Router } from "express";
import { savedDesignController } from "./saved-design.controller";
import { protect } from "../../middleware/auth";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import { createDesignSchema, updateDesignSchema, designParamSchema } from "./saved-design.schema";

const router = Router();

router.get("/", protect, sellerLimiter, savedDesignController.list);
router.post("/", protect, sellerLimiter, validate(createDesignSchema), savedDesignController.create);
router.get("/:designId", protect, sellerLimiter, validate(designParamSchema), savedDesignController.get);
router.patch("/:designId", protect, sellerLimiter, validate(updateDesignSchema), savedDesignController.update);
router.delete("/:designId", protect, sellerLimiter, validate(designParamSchema), savedDesignController.delete);

export default router;

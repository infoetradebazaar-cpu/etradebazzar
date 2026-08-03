import { Router } from "express";
import { wishlistController } from "./wishlist.controller";
import { protect } from "../../middleware/auth";
import { validate } from "../../utils/validate";
import { sellerLimiter } from "../../middleware/rate-limit";
import { addWishlistItemSchema, removeWishlistItemSchema } from "./wishlist.schema";

const router = Router();

router.get("/", protect, sellerLimiter, wishlistController.list);
router.post("/items", protect, sellerLimiter, validate(addWishlistItemSchema), wishlistController.addItem);
router.delete("/items/:productId", protect, sellerLimiter, validate(removeWishlistItemSchema), wishlistController.removeItem);

export default router;

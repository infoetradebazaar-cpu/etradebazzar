import express from "express";
import { Request, Response, NextFunction, Application } from "express";
import { randomUUID } from "crypto";

import { logger } from "./utils/logger";

import { security } from "./middleware/security";
import { authLimiter } from "./middleware/rate-limit";
import authRoutes from "./routes/auth.routes";
import { protect } from "./middleware/auth";
import sellerRoutes from "./modules/seller/seller.routes";
import verificationRoutes from "./modules/verification/verification.routes";
import shopRoutes from "./modules/shop/shop.routes";
import productRoutes from "./modules/product/product.routes";
import platformRoutes from "./modules/platform/platform.routes";
import orderRoutes from "./modules/order/order.routes";
import shipmentRoutes from "./modules/shipment/shipment.routes";
import paymentRoutes from "./modules/payment/payment.routes";
import categoryRoutes from "./modules/category/category.routes";
import returnRoutes from "./modules/return/return.routes";
import payoutRoutes from "./modules/payout/payout.routes";
import analyticsRoutes from "./modules/analytics/analytics.routes";
import reviewsRoutes from "./modules/review/review.routes";
import couponRoutes from "./modules/coupon/coupon.routes";
import sellerProfileRoutes from "./modules/seller/seller-profile.routes";
import securityRoutes from "./modules/security/security.routes";
import walletRoutes from "./modules/wallet/wallet.routes";
import gstRoutes from "./modules/gst/gst.routes";
import templateRoutes from "./modules/template/template.routes";
import printAreaRoutes from "./modules/print-area/print-area.routes";
import userRoutes from "./modules/user/user.routes";
import customerRoutes from "./modules/customer/customer.routes";
import cartRoutes from "./modules/cart/cart.routes";
import wishlistRoutes from "./modules/wishlist/wishlist.routes";
import uploadAssetRoutes from "./modules/upload-asset/upload-asset.routes";
import notificationRoutes from "./modules/notification/notification.routes";
import addressRoutes from "./modules/address/address.routes";
import locationRoutes from "./modules/location/location.routes";


declare global {
  namespace Express {
    interface Request {
      id: string;
      timedout?: boolean;
    }
  }
}
const app: Application = express();

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
} else {
  logger.warn(
    "TRUST_PROXY_HOPS not set req.ip and X-Forwarded-For based rate limiting may be unreliable behind a proxy/load balancer"
  );
}

app.use((req: Request, res: Response, next: NextFunction) => {
  req.id = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
});

app.use(...security);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setTimeout(15000, () => {
    req.timedout = true;
    if (!res.headersSent) {
      res.status(503).json({ error: "Request timeout", requestId: req.id });
    }
  });
  next();
});

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "unknown",
  });

  logger.info({ ip: req.ip, requestId: req.id }, "Health check");
});

app.use("/api/v1/auth", authLimiter, authRoutes);

app.get("/api/v1/me", protect, (req: Request, res: Response) => {
  res.json({
    message: "Welcome to protected area",
    user: req.user,
  });
});
app.use("/api/v1/sellers", sellerRoutes);
app.use("/api/v1/verification", verificationRoutes);
app.use("/api/v1/shops", shopRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/platform", platformRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/shipments", shipmentRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/returns", returnRoutes);
app.use("/api/v1/payouts", payoutRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/reviews", reviewsRoutes);
app.use("/api/v1/coupons", couponRoutes);
app.use("/api/v1/seller-profile", sellerProfileRoutes);
app.use("/api/v1/security", securityRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/gst", gstRoutes);
app.use("/api/v1/templates", templateRoutes);
app.use("/api/v1/print-areas", printAreaRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/wishlist", wishlistRoutes);
app.use("/api/v1/upload-asset", uploadAssetRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/addresses", addressRoutes);
app.use("/api/v1/location", locationRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Route not found",
    method: req.method,
    path: req.originalUrl,
  });
});

app.use((err: any, req: Request, res: Response, _: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";

  logger.error(
    {
      err,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      requestId: req.id,
      userId: (req as any).user?.id,
      status,
    },
    "Unhandled exception",
  );

  res.status(status).json({
    error: message,
    requestId: req.id,
    ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {}),
  });
});

export default app;

import { db } from "../../db";
import { redis } from "../../db/redis";
import { notificationService } from "../../modules/notification/notification.service";
import { logger } from "../../utils/logger";
import { config } from "../../../config/config";

const DEFAULT_LOW_STOCK_THRESHOLD = Number(
  process.env.LOW_STOCK_THRESHOLD ?? 10,
);
const ALERT_DEDUP_TTL = 60 * 60 * 24;

function dedupKey(productId: string, skuId?: string): string {
  return skuId ? `lowstock:sku:${skuId}` : `lowstock:product:${productId}`;
}

export async function checkLowStock(
  productId: string,
  prevStock: number,
  currStock: number,
  skuId?: string,
): Promise<void> {
  try {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sellerId: true,
        lowStockThreshold: true,
      },
    });

    if (!product) return;

    const threshold = product.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

    const crossed = prevStock > threshold && currStock <= threshold;
    if (!crossed) return;

    const key = dedupKey(productId, skuId);
    const alreadyAlerted = await redis.get(key);
    if (alreadyAlerted) return;
    await redis.setex(key, ALERT_DEDUP_TTL, "1");

    const owner = await db.sellerMember.findFirst({
      where: {
        sellerId: product.sellerId,
        role: { name: "owner" },
        isActive: true,
      },
      select: { userId: true, user: { select: { email: true, name: true } } },
    });
    if (!owner) return;

    const label = skuId ? `SKU stock` : `Product stock`;
    const stockLabel = `${currStock} units remaining !!`;

    await notificationService.notify({
      userId: owner.userId,
      email: owner.user.email,
      type: "PRODUCT_LOW_STOCK" as any,
      title: "Low stock alert",
      message: `${product.name}  ${label} is low. ${stockLabel}.`,
      channels: ["email", "sse"],
      emailTemplate: "low-stock",
      emailData: {
        sellerName: owner.user.name ?? "there",
        productName: product.name,
        currStock,
        threshold,
        productUrl: `${config.appUrl}/products/${productId}`,
      },
      data: { productId, skuId, currStock, threshold },
    });
    logger.info(
      { productId, skuId, prevStock, currStock, threshold },
      "Low stock alert fired",
    );
  } catch (err) {
    if (err instanceof Error) {
      logger.error({ err: err.message, productId }, "Low stock check failed");
    }
  }
}

export async function checkLowStockBatch(
  items: {
    productId: string;
    previousStock: number;
    currentStock: number;
    skuId?: string;
  }[],
): Promise<void> {
  await Promise.allSettled(
    items.map((item) => {
      checkLowStock(
        item.productId,
        item.previousStock,
        item.currentStock,
        item.skuId,
      );
    }),
  );
}

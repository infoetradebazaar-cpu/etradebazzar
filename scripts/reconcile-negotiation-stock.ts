import { db } from "../src/db/index";
import { logger } from "../src/utils/logger";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const EXCLUDED_STATUSES = new Set(["CANCELLED", "RETURNED"]);

async function main() {
  const sessions = await db.negotiationSession.findMany({
    where: { orderId: { not: null } },
    select: { skuId: true, orderId: true, quantity: true },
  });
  const negotiatedOrderIds = new Set(sessions.map((s) => s.orderId!));

  const negotiatedOrders = await db.order.findMany({
    where: { id: { in: [...negotiatedOrderIds] } },
    select: { id: true, status: true },
  });
  const statusByOrderId = new Map(negotiatedOrders.map((o) => [o.id, o.status]));

  const neverDecrementedQtyBySku = new Map<string, number>();
  const excludedQtyBySku = new Map<string, number>();
  for (const session of sessions) {
    const status = statusByOrderId.get(session.orderId!);
    const bucket = status && EXCLUDED_STATUSES.has(status) ? excludedQtyBySku : neverDecrementedQtyBySku;
    bucket.set(session.skuId, (bucket.get(session.skuId) ?? 0) + session.quantity);
  }

  const completedReturns = await db.returnRequest.findMany({
    where: { status: "COMPLETED" },
    select: { orderId: true },
  });
  const restorableOrderIds = completedReturns
    .map((r) => r.orderId)
    .filter((id) => !negotiatedOrderIds.has(id));

  const returnedItems = await db.orderItem.findMany({
    where: { orderId: { in: restorableOrderIds } },
    select: { productId: true, skuId: true, quantity: true },
  });

  const neverRestoredQtyBySku = new Map<string, number>();
  const neverRestoredQtyByProduct = new Map<string, number>();
  for (const item of returnedItems) {
    if (item.skuId) {
      neverRestoredQtyBySku.set(item.skuId, (neverRestoredQtyBySku.get(item.skuId) ?? 0) + item.quantity);
    } else {
      neverRestoredQtyByProduct.set(item.productId, (neverRestoredQtyByProduct.get(item.productId) ?? 0) + item.quantity);
    }
  }

  if (
    neverDecrementedQtyBySku.size === 0 &&
    neverRestoredQtyBySku.size === 0 &&
    neverRestoredQtyByProduct.size === 0
  ) {
    console.log("No affected SKUs or products found. Nothing to reconcile.");
    process.exit(0);
  }

  const affectedSkuIds = new Set([...neverDecrementedQtyBySku.keys(), ...neverRestoredQtyBySku.keys()]);
  const skus = await db.productSKU.findMany({
    where: { id: { in: [...affectedSkuIds] } },
    select: { id: true, sku: true, stock: true, product: { select: { name: true, sellerId: true } } },
  });

  type SkuRow = {
    skuId: string;
    skuCode: string;
    productName: string;
    sellerId: string;
    currentStock: number;
    neverDecrementedQty: number;
    neverRestoredQty: number;
    excludedQty: number;
    impliedCorrectStock: number;
    alreadyOversold: boolean;
  };

  const skuRows: SkuRow[] = skus.map((sku) => {
    const neverDecrementedQty = neverDecrementedQtyBySku.get(sku.id) ?? 0;
    const neverRestoredQty = neverRestoredQtyBySku.get(sku.id) ?? 0;
    const impliedCorrectStock = sku.stock - neverDecrementedQty + neverRestoredQty;
    return {
      skuId: sku.id,
      skuCode: sku.sku,
      productName: sku.product.name,
      sellerId: sku.product.sellerId,
      currentStock: sku.stock,
      neverDecrementedQty,
      neverRestoredQty,
      excludedQty: excludedQtyBySku.get(sku.id) ?? 0,
      impliedCorrectStock,
      alreadyOversold: impliedCorrectStock < 0,
    };
  });
  skuRows.sort((a, b) => a.impliedCorrectStock - b.impliedCorrectStock);

  const affectedProductIds = [...neverRestoredQtyByProduct.keys()];
  const products = await db.product.findMany({
    where: { id: { in: affectedProductIds } },
    select: { id: true, name: true, sellerId: true, stock: true },
  });

  type ProductRow = {
    productId: string;
    productName: string;
    sellerId: string;
    currentStock: number;
    neverRestoredQty: number;
    impliedCorrectStock: number;
  };

  const productRows: ProductRow[] = products.map((product) => {
    const neverRestoredQty = neverRestoredQtyByProduct.get(product.id) ?? 0;
    const currentStock = product.stock ?? 0;
    return {
      productId: product.id,
      productName: product.name,
      sellerId: product.sellerId,
      currentStock,
      neverRestoredQty,
      impliedCorrectStock: currentStock + neverRestoredQty,
    };
  });
  productRows.sort((a, b) => b.neverRestoredQty - a.neverRestoredQty);

  console.log(`\nStock reconciliation ${skuRows.length} SKU(s), ${productRows.length} no-SKU product(s) affected\n`);

  if (skuRows.length > 0) {
    console.log("SKU-level (negotiation decrement gap + return restoration gap):");
    console.log(
      ["SKU", "Product", "Current Stock", "Never Decremented", "Never Restored", "Implied Correct Stock", "Excluded (cancelled/returned)"].join(
        " | ",
      ),
    );
    for (const row of skuRows) {
      console.log(
        [
          row.skuCode,
          row.productName,
          row.currentStock,
          row.neverDecrementedQty,
          row.neverRestoredQty,
          row.alreadyOversold ? `${row.impliedCorrectStock}  ⚠ ALREADY OVERSOLD` : row.impliedCorrectStock,
          row.excludedQty,
        ].join(" | "),
      );
    }
  }

  if (productRows.length > 0) {
    console.log("\nProduct-level, no SKU (return restoration gap only):");
    console.log(["Product", "Current Stock", "Never Restored", "Implied Correct Stock"].join(" | "));
    for (const row of productRows) {
      console.log([row.productName, row.currentStock, row.neverRestoredQty, row.impliedCorrectStock].join(" | "));
    }
  }

  const oversoldCount = skuRows.filter((r) => r.alreadyOversold).length;
  console.log(
    `\n${skuRows.length + productRows.length} row(s) affected. ${oversoldCount} SKU(s) already show negative implied stock those have promised more units than physically exist and need priority review.`,
  );
  console.log("\nThis is a report only no stock was modified. Apply corrections manually after review.");

  const reportsDir = join(process.cwd(), "reports");
  mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, `negotiation-stock-reconciliation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), skuRows, productRows }, null, 2));
  console.log(`\nFull report written to ${outPath}`);

  process.exit(oversoldCount > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err: err.message }, "Stock reconciliation failed");
  process.exit(1);
});

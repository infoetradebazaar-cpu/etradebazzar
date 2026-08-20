import { db } from "../src/db/index";
import { logger } from "../src/utils/logger";

async function main() {
  const negotiatedOrderIds = new Set(
    (await db.negotiationSession.findMany({ where: { orderId: { not: null } }, select: { orderId: true } })).map(
      (s) => s.orderId!,
    ),
  );

  const items = await db.orderItem.findMany({
    where: { skuId: null },
    select: { id: true, orderId: true, productId: true, quantity: true, unitPrice: true, createdAt: true },
  });
  const standardItems = items.filter((i) => !negotiatedOrderIds.has(i.orderId));

  console.log(`\nStandard-checkout OrderItems with no skuId recorded: ${standardItems.length}`);
  console.log(
    "(Expected to be ALL of them pre-fix skuId was dropped before OrderItem creation, so this count alone proves nothing by itself.)\n",
  );

  const productIds = [...new Set(standardItems.map((i) => i.productId))];
  const skusByProduct = await db.productSKU.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, price: true },
  });
  const skuPricesByProduct = new Map<string, number[]>();
  for (const sku of skusByProduct) {
    const list = skuPricesByProduct.get(sku.productId) ?? [];
    list.push(Number(sku.price));
    skuPricesByProduct.set(sku.productId, list);
  }

  const productsWithSkusToday = productIds.filter((id) => (skuPricesByProduct.get(id)?.length ?? 0) > 0);
  console.log(`Of those, items belonging to a product that HAS SKUs today: checking ${productsWithSkusToday.length} product(s).`);

  const suspectRows = standardItems.filter((item) => {
    const skuPrices = skuPricesByProduct.get(item.productId);
    if (!skuPrices || skuPrices.length === 0) return false;
    const charged = Number(item.unitPrice);
    return !skuPrices.some((p) => Math.abs(p - charged) < 0.01);
  });

  console.log(
    `\nProxy result: ${suspectRows.length} historical standard-checkout OrderItem(s) on SKU'd products where the charged price doesn't match any CURRENT SKU price for that product.`,
  );
  console.log(
    "This is a weak signal, not a confirmed mismatch count see header comment. No order amounts, refunds, or historical records were touched.",
  );

  if (suspectRows.length > 0) {
    console.log("\nSample (up to 10):");
    for (const row of suspectRows.slice(0, 10)) {
      console.log(
        `  orderItemId=${row.id} orderId=${row.orderId} productId=${row.productId} charged=${row.unitPrice} currentSkuPrices=${skuPricesByProduct.get(row.productId)?.join(",")} createdAt=${row.createdAt.toISOString()}`,
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err.message }, "Checkout SKU price-mismatch audit failed");
  process.exit(1);
});

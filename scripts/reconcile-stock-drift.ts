import { db } from "../src/db/index";
import { logger } from "../src/utils/logger";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
async function main() {
  const productsWithSkus = await db.product.findMany({
    where: { skus: { some: {} } },
    select: {
      id: true,
      name: true,
      sellerId: true,
      stock: true,
      skus: { select: { id: true, sku: true, stock: true } },
    },
  });

  type DriftRow = {
    productId: string;
    productName: string;
    sellerId: string;
    productStock: number;
    skuCount: number;
    totalSkuStock: number;
    allSkusZero: boolean;
  };

  const driftRows: DriftRow[] = productsWithSkus
    .map((p) => {
      const totalSkuStock = p.skus.reduce((sum, s) => sum + (s.stock ?? 0), 0);
      return {
        productId: p.id,
        productName: p.name,
        sellerId: p.sellerId,
        productStock: p.stock ?? 0,
        skuCount: p.skus.length,
        totalSkuStock,
        allSkusZero: p.skus.every((s) => (s.stock ?? 0) === 0),
      };
    })
    .filter((row) => row.productStock !== 0);

  driftRows.sort((a, b) => b.productStock - a.productStock);

  if (driftRows.length === 0) {
    console.log("No stock drift found. Every product with SKUs has Product.stock = 0/null. Nothing to reconcile.");
    process.exit(0);
  }

  console.log(`\nStock drift reconciliation ${driftRows.length} product(s) with nonzero Product.stock despite having SKUs\n`);
  console.log(["Product", "ProductId", "Product.stock", "SKU count", "Sum(SKU.stock)", "All SKUs zero?"].join(" | "));
  for (const row of driftRows) {
    console.log(
      [
        row.productName,
        row.productId,
        row.productStock,
        row.skuCount,
        row.totalSkuStock,
        row.allSkusZero ? "YES unorderable but shows in-stock" : "no",
      ].join(" | "),
    );
  }

  const unorderableCount = driftRows.filter((r) => r.allSkusZero).length;
  console.log(
    `\n${driftRows.length} product(s) affected. ${unorderableCount} of them are completely sold out at the SKU level (all SKU stock = 0) while Product.stock still reports availability these are the highest-priority rows: any code path still reading Product.stock directly for these will show them as in-stock when they cannot actually be fulfilled.`,
  );
  console.log("\nThis is a report only no stock was modified. Review and zero Product.stock manually for the rows above.");

  const reportsDir = join(process.cwd(), "reports");
  mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, `stock-drift-reconciliation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), driftRows }, null, 2));
  console.log(`\nFull report written to ${outPath}`);

  process.exit(unorderableCount > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err: err.message }, "Stock drift reconciliation failed");
  process.exit(1);
});

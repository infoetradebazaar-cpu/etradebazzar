/**
 * Rebuilds the OpenSearch product index from Postgres (source of truth).
 */
import { db } from "../src/db/index";
import { logger } from "../src/utils/logger";
import { SearchIndexFactory } from "../src/lib/search/search-index.factory";
import { buildSearchDocument } from "../src/lib/search/product-search-document";

const BATCH_SIZE = 200;

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEARCH_REINDEX !== "true") {
    logger.error(
      "Refusing to run reindex-search.ts against production without ALLOW_PROD_SEARCH_REINDEX=true",
    );
    process.exit(1);
  }

  const provider = SearchIndexFactory.get();
  await provider.ensureIndex();

  const approvedCount = await db.product.count({ where: { status: "APPROVED" } });
  console.log(`Reindexing search: ${approvedCount} APPROVED product(s) found in Postgres.\n`);

  let indexed = 0;
  let failed = 0;
  let cursor: string | undefined;
  const approvedIds = new Set<string>();

  while (true) {
    const batch = await db.product.findMany({
      where: { status: "APPROVED" },
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (!batch.length) break;

    for (const { id } of batch) {
      approvedIds.add(id);
      try {
        const doc = await buildSearchDocument(id);
        if (doc) {
          await provider.indexProduct(doc);
          indexed++;
        }
      } catch (err: any) {
        failed++;
        logger.warn({ err: err.message, productId: id }, "Failed to reindex product");
      }
    }

    cursor = batch[batch.length - 1]!.id;
    console.log(`  ...${indexed + failed}/${approvedCount} processed`);
  }

  console.log("\nChecking for orphaned index entries (indexed but no longer APPROVED)...");
  const indexedIds = await provider.listAllProductIds();
  const orphanIds = indexedIds.filter((id) => !approvedIds.has(id));

  let pruned = 0;
  for (const id of orphanIds) {
    try {
      await provider.deleteProduct(id);
      pruned++;
    } catch (err: any) {
      logger.warn({ err: err.message, productId: id }, "Failed to prune orphaned index entry");
    }
  }

  console.log(`\nReindex complete - ${indexed} indexed, ${failed} failed, ${pruned} orphan(s) pruned.`);
  if (failed > 0) {
    console.log("Failures were logged above - re-run this script to retry (it's idempotent).");
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err: err.message }, "Search reindex failed");
  process.exit(1);
});

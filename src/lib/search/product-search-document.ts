import { db } from "../../db/index";
import { SearchProductDocument, SearchProductAttribute } from "./search-index.interface";
import { SearchIndexFactory } from "./search-index.factory";
import { logger } from "../../utils/logger";

async function getCategoryPath(categoryId: string): Promise<{ path: string[]; name: string }> {
  const path: string[] = [];
  let currentId: string | null = categoryId;
  let name = "";

  while (currentId) {
    const category: { id: string; name: string; parentId: string | null } | null =
      await db.category.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, parentId: true },
      });
    if (!category) break;
    if (currentId === categoryId) name = category.name;
    path.unshift(category.id);
    currentId = category.parentId;
  }

  return { path, name };
}

/**
 * Builds the search index document for one product.
 */
export async function buildSearchDocument(productId: string): Promise<SearchProductDocument | null> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      categoryId: true,
      sellerId: true,
      createdAt: true,
      images: { orderBy: { order: "asc" }, take: 1, select: { key: true } },
      skus: { select: { price: true, options: true } },
      negotiationThresholdQty: true,
    },
  });
  if (!product) return null;

  const { path: categoryPath, name: categoryName } = await getCategoryPath(product.categoryId);

  const attributeSet = new Map<string, SearchProductAttribute>();
  for (const sku of product.skus) {
    const options = sku.options as Record<string, string> | null;
    if (!options) continue;
    for (const [name, value] of Object.entries(options)) {
      attributeSet.set(`${name}::${value}`, { name, value });
    }
  }

  const skuPrices = product.skus.map((s) => Number(s.price)).filter((p) => Number.isFinite(p));
  const basePrice = product.price !== null ? Number(product.price) : null;
  const allPrices = [...skuPrices, ...(basePrice !== null ? [basePrice] : [])];

  return {
    id: product.id,
    name: product.name,
    description: product.description ?? "",
    price: basePrice ?? (allPrices.length ? Math.min(...allPrices) : 0),
    minSkuPrice: allPrices.length ? Math.min(...allPrices) : null,
    maxSkuPrice: allPrices.length ? Math.max(...allPrices) : null,
    categoryId: product.categoryId,
    categoryName,
    categoryPath,
    sellerId: product.sellerId,
    imageKey: product.images[0]?.key ?? null,
    negotiationThresholdQty: product.negotiationThresholdQty ?? null,
    attributes: [...attributeSet.values()],
    createdAt: product.createdAt.toISOString(),
  };
}

export async function syncProductSearchIndex(productId: string): Promise<void> {
  const provider = SearchIndexFactory.get();

  const product = await db.product.findUnique({
    where: { id: productId },
    select: { status: true },
  });

  if (!product || (product.status !== "LIVE" && product.status !== "APPROVED")) {
    await provider.deleteProduct(productId);
    return;
  }

  const doc = await buildSearchDocument(productId);
  if (doc) await provider.indexProduct(doc);
}

export function syncProductSearchIndexInBackground(productId: string): void {
  syncProductSearchIndex(productId).catch((err: any) =>
    logger.warn({ err: err.message, productId }, "Failed to sync product to search index"),
  );
}

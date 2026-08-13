import { db } from "../../db/index";
import { SearchIndexFactory } from "./search-index.factory";

export interface CategoryDrift {
  categoryId: string;
  categoryName: string;
  sourceCount: number;
  indexedCount: number;
  drift: number;
}

export interface ReconciliationResult {
  totalSourceCount: number;
  totalIndexedCount: number;
  hasDrift: boolean;
  categories: CategoryDrift[];
}

export async function reconcileSearchIndex(): Promise<ReconciliationResult> {
  const provider = SearchIndexFactory.get();

  const [sourceGroups, indexedCounts, categories] = await Promise.all([
    db.product.groupBy({
      by: ["categoryId"],
      where: { status: "LIVE" },
      _count: { _all: true },
    }),
    provider.countByCategory(),
    db.category.findMany({ select: { id: true, name: true } }),
  ]);

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const sourceCountById = new Map(sourceGroups.map((g) => [g.categoryId, g._count._all]));

  const categoryIds = new Set<string>([
    ...sourceCountById.keys(),
    ...Object.keys(indexedCounts),
  ]);

  const drifted: CategoryDrift[] = [];
  let totalSourceCount = 0;
  let totalIndexedCount = 0;

  for (const categoryId of categoryIds) {
    const sourceCount = sourceCountById.get(categoryId) ?? 0;
    const indexedCount = indexedCounts[categoryId] ?? 0;
    totalSourceCount += sourceCount;
    totalIndexedCount += indexedCount;

    if (sourceCount !== indexedCount) {
      drifted.push({
        categoryId,
        categoryName: categoryNameById.get(categoryId) ?? "(unknown category)",
        sourceCount,
        indexedCount,
        drift: indexedCount - sourceCount,
      });
    }
  }

  drifted.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  return {
    totalSourceCount,
    totalIndexedCount,
    hasDrift: drifted.length > 0,
    categories: drifted,
  };
}
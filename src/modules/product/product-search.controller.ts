import { Request, Response } from "express";
import { productSearchService } from "./product-search.service";
import { reconcileSearchIndex } from "../../lib/search/search-reconciliation";
import { SearchSort } from "../../lib/search/search-index.interface";
import { SearchIndexFactory } from "../../lib/search/search-index.factory";
import { buildSearchDocument } from "../../lib/search/product-search-document";
import { db } from "../../db/index";
import { logger } from "../../utils/logger";

interface SearchQuery {
    q?: string;
    categoryId?: string;
    minPrice?: string;
    maxPrice?: string;
    sellerId?: string;
    sort?: SearchSort;
    attributes?: Record<string, string[]>;
    page?: string;
    limit?: string;
}

export const productSearchController = {
    async searchProducts(req: Request, res: Response) {
        try {
            const {
                q,
                categoryId,
                minPrice,
                maxPrice,
                sellerId,
                sort,
                attributes,
                page,
                limit,
            } = req.query as unknown as SearchQuery;

            const result = await productSearchService.searchProducts({
                q,
                categoryId,
                minPrice: minPrice ? Number(minPrice) : undefined,
                maxPrice: maxPrice ? Number(maxPrice) : undefined,
                sellerId,
                sort,
                attributes,
                page: page ? Number(page) : undefined,
                limit: limit ? Number(limit) : undefined,
            });

            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Product search failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getFacets(req: Request, res: Response) {
        try {
            const { q, categoryId, minPrice, maxPrice, sellerId, attributes } =
                req.query as unknown as SearchQuery;

            const result = await productSearchService.getFacets({
                q,
                categoryId,
                minPrice: minPrice ? Number(minPrice) : undefined,
                maxPrice: maxPrice ? Number(maxPrice) : undefined,
                sellerId,
                attributes,
            });

            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Product facets lookup failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async reconcileIndex(_req: Request, res: Response) {
        try {
            const result = await reconcileSearchIndex();
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Search index reconciliation failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async reindexAll(_req: Request, res: Response) {
        try {
            const provider = SearchIndexFactory.get();
            await provider.recreateIndex();

            let indexed = 0;
            let failed = 0;
            let cursor: string | undefined;

            while (true) {
                const batch = await db.product.findMany({
                    where: { status: { in: ["LIVE", "APPROVED"] } },
                    select: { id: true },
                    orderBy: { id: "asc" },
                    take: 200,
                    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
                });
                if (!batch.length) break;

                for (const { id } of batch) {
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
            }

            return res.json({ success: true, data: { indexed, failed } });
        } catch (error: any) {
            logger.error({ err: error.message }, "Search reindex failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};
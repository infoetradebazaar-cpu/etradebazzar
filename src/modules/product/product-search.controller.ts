import { Request, Response } from "express";
import { productSearchService } from "./product-search.service";
import { reconcileSearchIndex } from "../../lib/search/search-reconciliation";
import { SearchSort } from "../../lib/search/search-index.interface";
import { logger } from "../../utils/logger";

interface SearchQuery {
    q?: string;
    categoryId?: string;
    minPrice?: string;
    maxPrice?: string;
    sellerId?: string;
    shopId?: string;
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
                shopId,
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
                shopId,
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
            const { q, categoryId, minPrice, maxPrice, sellerId, shopId, attributes } =
                req.query as unknown as SearchQuery;

            const result = await productSearchService.getFacets({
                q,
                categoryId,
                minPrice: minPrice ? Number(minPrice) : undefined,
                maxPrice: maxPrice ? Number(maxPrice) : undefined,
                sellerId,
                shopId,
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
};
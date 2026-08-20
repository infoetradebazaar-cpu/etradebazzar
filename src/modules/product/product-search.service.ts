import { SearchIndexFactory } from "../../lib/search/search-index.factory";
import { SearchFilters, SearchSort, SearchProductDocument } from "../../lib/search/search-index.interface";
import { StorageFactory } from "../../lib/storage/storage.factory";
import { parseSearchQuery } from "../../lib/search/query-parser";

const MAX_LIMIT = 60; // mirrors OpenSearchIndexInstance's own MAX_PAGE_SIZE hard cap
const DEFAULT_LIMIT = 20;

export interface SearchProductsInput extends SearchFilters {
    page?: number;
    limit?: number;
    sort?: SearchSort;
}

async function resolveResultImages(products: SearchProductDocument[]) {
    const storage = StorageFactory.get();
    return Promise.all(
        products.map(async ({ imageKey, ...rest }) => ({
            ...rest,
            imageUrl: imageKey ? await storage.getSignedUrl({ key: imageKey, expiresIn: 3600 }) : null,
        })),
    );
}

async function applyQueryParser<T extends SearchFilters>(filters: T): Promise<T> {
    if (!filters.q) return filters;

    const parsed = await parseSearchQuery(filters.q);
    const mergedAttributes = { ...parsed.attributes, ...filters.attributes };

    return {
        ...filters,
        q: parsed.q,
        minPrice: filters.minPrice ?? parsed.minPrice,
        maxPrice: filters.maxPrice ?? parsed.maxPrice,
        ...(Object.keys(mergedAttributes).length > 0 && { attributes: mergedAttributes }),
    };
}

export const productSearchService = {
    async searchProducts(input: SearchProductsInput) {
        const page = Math.max(1, input.page ?? 1);
        const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));

        const filters = await applyQueryParser(input);

        const provider = SearchIndexFactory.get();
        const { products, total } = await provider.search({
            q: filters.q,
            categoryId: filters.categoryId,
            minPrice: filters.minPrice,
            maxPrice: filters.maxPrice,
            sellerId: filters.sellerId,
            attributes: filters.attributes,
            page,
            limit,
            sort: input.sort ?? "relevance",
        });

        return {
            products: await resolveResultImages(products),
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                hasNext: page * limit < total,
                hasPrev: page > 1,
            },
        };
    },

    async getFacets(filters: SearchFilters) {
        const provider = SearchIndexFactory.get();
        return provider.getFacets(await applyQueryParser(filters));
    },
};
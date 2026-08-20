import {
  SearchIndexProvider,
  SearchProductDocument,
  SearchQuery,
  SearchResult,
  SearchFilters,
  FacetResult,
  CategoryCounts,
} from "./search-index.interface";
import { logger } from "../../utils/logger";

/**
 * No-op provider for local dev/CI without OpenSearch running. Never throws
 * search just returns empty results rather than breaking the app
 */
export class SandboxSearchIndexInstance implements SearchIndexProvider {
  async ensureIndex(): Promise<void> {
    logger.warn("SearchIndexProvider=sandbox product search index is a no-op");
  }

  async recreateIndex(): Promise<void> {
    // no-op
  }

  async indexProduct(_doc: SearchProductDocument): Promise<void> {
    // no-op
  }

  async deleteProduct(_productId: string): Promise<void> {
    // no-op
  }

  async search(_query: SearchQuery): Promise<SearchResult> {
    return { products: [], total: 0 };
  }

  async getFacets(_filters: SearchFilters): Promise<FacetResult> {
    return { attributes: {}, priceRange: null };
  }

  async countByCategory(): Promise<CategoryCounts> {
    return {};
  }

  async listAllProductIds(): Promise<string[]> {
    return [];
  }
}

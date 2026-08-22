export interface SearchProductAttribute {
  name: string;
  value: string;
}

export interface SearchProductDocument {
  id: string;
  name: string;
  description: string;
  price: number;
  minSkuPrice: number | null;
  maxSkuPrice: number | null;
  categoryId: string;
  categoryName: string;
  categoryPath: string[];
  sellerId: string;
  imageKey: string | null;
  negotiationThresholdQty: number | null;
  attributes: SearchProductAttribute[];
  createdAt: string;
}
// MAQ update pending in the searchSort
export type SearchSort = "relevance" | "price_asc" | "price_desc" | "newest";

export interface SearchFilters {
  q?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  sellerId?: string;
  attributes?: Record<string, string[]>;
}

export interface SearchQuery extends SearchFilters {
  page: number;
  limit: number;
  sort: SearchSort;
}

export interface SearchResult {
  products: SearchProductDocument[];
  total: number;
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface FacetResult {
  attributes: Record<string, FacetBucket[]>;
  priceRange: { min: number; max: number } | null;
}

export interface CategoryCounts {
  [categoryId: string]: number;
}

export interface SearchIndexProvider {
  ensureIndex(): Promise<void>;
  recreateIndex(): Promise<void>;
  indexProduct(doc: SearchProductDocument): Promise<void>;
  deleteProduct(productId: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult>;
  getFacets(filters: SearchFilters): Promise<FacetResult>;
  countByCategory(): Promise<CategoryCounts>;
  listAllProductIds(): Promise<string[]>;
}

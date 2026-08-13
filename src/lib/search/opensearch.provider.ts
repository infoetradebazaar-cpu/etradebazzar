import { Client } from "@opensearch-project/opensearch";
import {
  SearchIndexProvider,
  SearchProductDocument,
  SearchQuery,
  SearchResult,
  SearchFilters,
  FacetResult,
  FacetBucket,
  CategoryCounts,
} from "./search-index.interface";
import { logger } from "../../utils/logger";

const INDEX_NAME = "products";

const MAX_PAGE_SIZE = 60;
const MAX_FACET_BUCKETS = 50;

export class OpenSearchIndexInstance implements SearchIndexProvider {
  private client: Client;

  constructor(url: string, username: string, password: string, tlsRejectUnauthorized: boolean) {
    this.client = new Client({
      node: url,
      auth: { username, password },
      ssl: { rejectUnauthorized: tlsRejectUnauthorized },
    });
  }

  async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: INDEX_NAME });
    if (exists.body) return;

    await this.client.indices.create({
      index: INDEX_NAME,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            filter: {
              product_word_delimiter: {
                type: "word_delimiter_graph",
                catenate_words: true,
                preserve_original: true,
              },
            },
            analyzer: {
              product_text: {
                type: "custom",
                tokenizer: "whitespace",
                filter: ["lowercase", "product_word_delimiter"],
              },
            },
          },
        },
        mappings: {
          properties: {
            id: { type: "keyword" },
            name: {
              type: "text",
              analyzer: "product_text",
              fields: { keyword: { type: "keyword" } },
            },
            description: { type: "text", analyzer: "product_text" },
            price: { type: "double" },
            minSkuPrice: { type: "double" },
            maxSkuPrice: { type: "double" },
            categoryId: { type: "keyword" },
            categoryName: { type: "keyword" },
            categoryPath: { type: "keyword" },
            sellerId: { type: "keyword" },
            shopId: { type: "keyword" },
            shopName: { type: "keyword" },
            imageKey: { type: "keyword", index: false },
            attributes: {
              type: "nested",
              properties: {
                name: { type: "keyword" },
                value: { type: "keyword" },
              },
            },
            createdAt: { type: "date" },
          },
        },
      },
    });
    logger.info({ index: INDEX_NAME }, "Search index created");
  }

  async indexProduct(doc: SearchProductDocument): Promise<void> {
    await this.client.index({
      index: INDEX_NAME,
      id: doc.id,
      body: doc,
      refresh: false,
    });
  }

  async deleteProduct(productId: string): Promise<void> {
    try {
      await this.client.delete({ index: INDEX_NAME, id: productId });
    } catch (error: any) {
      if (error?.meta?.statusCode !== 404) throw error;
    }
  }

  private buildFilterClauses(filters: SearchFilters, excludeAttributeName?: string): any[] {
    const filter: any[] = [];

    if (filters.categoryId) {
      filter.push({ term: { categoryPath: filters.categoryId } });
    }
    if (filters.sellerId) {
      filter.push({ term: { sellerId: filters.sellerId } });
    }
    if (filters.shopId) {
      filter.push({ term: { shopId: filters.shopId } });
    }
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const range: any = {};
      if (filters.minPrice !== undefined) range.gte = filters.minPrice;
      if (filters.maxPrice !== undefined) range.lte = filters.maxPrice;
      filter.push({ range: { price: range } });
    }

    for (const [name, values] of Object.entries(filters.attributes ?? {})) {
      if (name === excludeAttributeName || !values.length) continue;
      filter.push({
        nested: {
          path: "attributes",
          query: {
            bool: {
              filter: [
                { term: { "attributes.name": name } },
                { terms: { "attributes.value": values } },
              ],
            },
          },
        },
      });
    }

    return filter;
  }

  private buildQuery(filters: SearchFilters, excludeAttributeName?: string): any {
    const must: any[] = [];
    if (filters.q) {
      must.push({
        simple_query_string: {
          query: filters.q,
          fields: ["name^3", "description"],
          default_operator: "and",
        },
      });
    }

    return {
      bool: {
        must,
        filter: this.buildFilterClauses(filters, excludeAttributeName),
      },
    };
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, query.limit));
    const page = Math.max(1, query.page);

    const sortClause =
      query.sort === "price_asc"
        ? [{ price: "asc" }]
        : query.sort === "price_desc"
          ? [{ price: "desc" }]
          : query.sort === "newest"
            ? [{ createdAt: "desc" }]
            : undefined; // relevance = default _score sort

    const response = await this.client.search({
      index: INDEX_NAME,
      body: {
        query: this.buildQuery(query),
        ...(sortClause && { sort: sortClause }),
        from: (page - 1) * limit,
        size: limit,
        track_total_hits: true,
      } as any,
    });

    const hits: any = response.body.hits;
    return {
      products: hits.hits.map((h: any) => h._source as SearchProductDocument),
      total: typeof hits.total === "number" ? hits.total : hits.total.value,
    };
  }

  async getFacets(filters: SearchFilters): Promise<FacetResult> {
    const attributeNames = new Set(Object.keys(filters.attributes ?? {}));

    const discovery = await this.client.search({
      index: INDEX_NAME,
      body: {
        query: this.buildQuery(filters),
        size: 0,
        aggs: {
          attribute_names: {
            nested: { path: "attributes" },
            aggs: {
              names: { terms: { field: "attributes.name", size: MAX_FACET_BUCKETS } },
            },
          },
          price_stats: { stats: { field: "price" } },
        },
      } as any,
    });

    const discoveryAggs: any = discovery.body.aggregations;
    for (const bucket of discoveryAggs.attribute_names.names.buckets) {
      attributeNames.add(bucket.key);
    }

    const attributes: Record<string, FacetBucket[]> = {};

    if (attributeNames.size > 0) {
      const aggs: Record<string, any> = {};
      for (const name of attributeNames) {
        aggs[`facet__${name}`] = {
          filter: {
            bool: { must: [], filter: this.buildFilterClauses(filters, name) },
          },
          aggs: {
            values: {
              nested: { path: "attributes" },
              aggs: {
                matching: {
                  filter: { term: { "attributes.name": name } },
                  aggs: {
                    values: { terms: { field: "attributes.value", size: MAX_FACET_BUCKETS } },
                  },
                },
              },
            },
          },
        };
      }

      const facetResponse = await this.client.search({
        index: INDEX_NAME,
        body: { query: this.buildQuery(filters), size: 0, aggs } as any,
      });

      const facetAggs: any = facetResponse.body.aggregations;
      for (const name of attributeNames) {
        const buckets = facetAggs[`facet__${name}`]?.values?.matching?.values?.buckets ?? [];
        attributes[name] = buckets.map((b: any) => ({ value: b.key, count: b.doc_count }));
      }
    }

    const stats: any = discoveryAggs.price_stats;
    const priceRange =
      stats && stats.count > 0 ? { min: stats.min, max: stats.max } : null;

    return { attributes, priceRange };
  }

  async countByCategory(): Promise<CategoryCounts> {
    const response = await this.client.search({
      index: INDEX_NAME,
      body: {
        size: 0,
        aggs: {
          by_category: { terms: { field: "categoryId", size: 1000 } },
        },
      } as any,
    });

    const result: CategoryCounts = {};
    const responseAggs: any = response.body.aggregations;
    for (const bucket of responseAggs.by_category.buckets) {
      result[bucket.key] = bucket.doc_count;
    }
    return result;
  }

  async listAllProductIds(): Promise<string[]> {
    const ids: string[] = [];
    const pageSize = 1000;

    let response = await this.client.search({
      index: INDEX_NAME,
      scroll: "1m",
      body: { query: { match_all: {} }, size: pageSize, _source: false } as any,
    });

    let hits: any[] = (response.body.hits as any).hits;
    let scrollId: string | undefined = (response.body as any)._scroll_id;

    while (hits.length > 0) {
      for (const hit of hits) ids.push(hit._id);
      if (hits.length < pageSize || !scrollId) break;

      response = await this.client.scroll({ scroll_id: scrollId, scroll: "1m" } as any);
      hits = (response.body.hits as any).hits;
      scrollId = (response.body as any)._scroll_id;
    }

    if (scrollId) {
      await this.client.clearScroll({ scroll_id: [scrollId] } as any).catch(() => {});
    }

    return ids;
  }
}

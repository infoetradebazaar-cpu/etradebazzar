import { SearchIndexProvider } from "./search-index.interface";
import { SandboxSearchIndexInstance } from "./sandbox.provider";
import { OpenSearchIndexInstance } from "./opensearch.provider";
import { config } from "../../../config/config";

type SearchIndexProviderType = "sandbox" | "opensearch";

class SearchIndexFactory {
    private static instances: Partial<Record<SearchIndexProviderType, SearchIndexProvider>> = {};

    static get(): SearchIndexProvider {
        const key = config.searchIndexProvider as SearchIndexProviderType;

        if (key === "sandbox" && config.nodeEnv === "production") {
            throw new Error(
                "SEARCH_INDEX_PROVIDER=sandbox is not allowed when NODE_ENV=production  this provider never contacts a real search index and always returns empty results"
            );
        }

        if (!this.instances[key]) {
            this.instances[key] = this.create(key);
        }

        return this.instances[key]!;
    }

    private static create(provider: SearchIndexProviderType): SearchIndexProvider {
        switch (provider) {
            case "sandbox":
                return new SandboxSearchIndexInstance();
            case "opensearch":
                return new OpenSearchIndexInstance(
                    config.opensearchUrl,
                    config.opensearchUsername,
                    config.opensearchPassword,
                    config.opensearchTlsRejectUnauthorized,
                );
            default:
                throw new Error(`Unsupported search index provider: ${provider}`);
        }
    }
}

export { SearchIndexFactory };

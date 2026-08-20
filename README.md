# Railway Shell Commands

# 0. Open Railway shell
railway link
railway service list
railway shell --service <service-name>

# 1. Reset (wipes all data, applies all migrations)
bun run db:reset

# 2. Generate Prisma client
bun run db:generate

# 3. Sync schema + RLS + analytics views
bun run db:push

# 4. Seed
bun run db:seed:full

# 5. Backfill platform RBAC
bun run db:backfill:platform-rbac

# 6. Backfill seller RBAC
bun run db:backfill:seller-rbac

# 7. Reindex search
bun run db:reindex

# Production (direct from local terminal with Railway proxy URLs)

# 1. Reset (wipes all data, applies all migrations)
DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  npx prisma migrate reset --force

# 2. Generate Prisma client
DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  npx prisma generate

# 3. Sync schema (creates tables not covered by migrations)
DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  npx prisma db push

# 4. RLS + analytics views
ALLOW_PROD_MIGRATE=true \
  DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  bun src/db/migrate.ts

# 5. Seed
ALLOW_PROD_MIGRATE=true \
  DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  REDIS_URL="redis://default:cowwssEFnaYRMpZiJZxPQNEtzVIVYtWm@tokaido.proxy.rlwy.net:15647" \
  OPENSEARCH_URL="https://opensearch-production-etrade.up.railway.app" \
  OPENSEARCH_USERNAME="admin" \
  OPENSEARCH_PASSWORD='OsnTcvZpfgH20g0EVqCifi@9' \
  OPENSEARCH_TLS_REJECT_UNAUTHORIZED="true" \
  SEARCH_INDEX_PROVIDER="opensearch" \
  STORAGE_PROVIDER="aws" \
  AWS_REGION="auto" \
  AWS_ACCESS_KEY_ID="tid_CH_YPrFPZWWHYIUhdcJPoGVQoxTLqVToUmsaQRQhbbDxwrGZyK" \
  AWS_SECRET_ACCESS_KEY="tsec_Dw9HuKp1phif4Zfc9bdzMosySIXmPdHHQ5avCbvQMkoNWDmygcGFtkCDCAioPaQ5VI6uEH" \
  AWS_S3_BUCKET="preserved-pannier-1inm5fc" \
  bun scripts/main-script.ts seed

# 6. Backfill platform RBAC
ALLOW_PROD_MIGRATE=true \
  DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  REDIS_URL="redis://default:cowwssEFnaYRMpZiJZxPQNEtzVIVYtWm@tokaido.proxy.rlwy.net:15647" \
  bun scripts/main-script.ts backfill-platform-rbac

# 7. Backfill seller RBAC
ALLOW_PROD_MIGRATE=true \
  DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  REDIS_URL="redis://default:cowwssEFnaYRMpZiJZxPQNEtzVIVYtWm@tokaido.proxy.rlwy.net:15647" \
  bun scripts/main-script.ts backfill-seller-rbac

# 8. Reindex search
ALLOW_PROD_MIGRATE=true \
  DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  REDIS_URL="redis://default:cowwssEFnaYRMpZiJZxPQNEtzVIVYtWm@tokaido.proxy.rlwy.net:15647" \
  OPENSEARCH_URL="https://opensearch-production-etrade.up.railway.app" \
  OPENSEARCH_USERNAME="admin" \
  OPENSEARCH_PASSWORD='OsnTcvZpfgH20g0EVqCifi@9' \
  OPENSEARCH_TLS_REJECT_UNAUTHORIZED="true" \
  SEARCH_INDEX_PROVIDER="opensearch" \
  bun scripts/main-script.ts reindex-search
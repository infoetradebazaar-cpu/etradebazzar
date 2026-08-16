# 1. Reset (wipes all data, applies all migrations)
DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  npx prisma migrate reset --force

# 2. Sync schema (creates tables not covered by migrations)
DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  npx prisma db push

# 3. RLS + analytics views (part of db:push locally)
ALLOW_PROD_MIGRATE=true \
  DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  bun src/db/migrate.ts

# 4. Seed
ALLOW_PROD_MIGRATE=true \
  DATABASE_URL="postgresql://postgres:pRNnmdybgIxzMvyOVVstbRPzSpXxNlLh@altaria.proxy.rlwy.net:45214/railway" \
  REDIS_URL="redis://default:cowwssEFnaYRMpZiJZxPQNEtzVIVYtWm@tokaido.proxy.rlwy.net:15647" \
  OPENSEARCH_URL="https://opensearch-production-etrade.up.railway.app:9200" \
  OPENSEARCH_USERNAME="admin" \
  OPENSEARCH_PASSWORD="OsnTcvZpfgH20g0EVqCifi99" \
  OPENSEARCH_TLS_REJECT_UNAUTHORIZED="true" \
  SEARCH_INDEX_PROVIDER="opensearch" \
  STORAGE_PROVIDER="aws" \
  AWS_REGION="auto" \
  AWS_ACCESS_KEY_ID="tid_CH_YPrFPZWWHYIUhdcJPoGVQoxTLqVToUmsaQRQhbbDxwrGZyK" \
  AWS_SECRET_ACCESS_KEY="tsec_Dw9HuKp1phif4Zfc9bdzMosySIXmPdHHQ5avCbvQMkoNWDmygcGFtkCDCAioPaQ5VI6uEH" \
  AWS_S3_BUCKET="preserved-pannier-1inm5fc" \
  bun scripts/main-script.ts seed
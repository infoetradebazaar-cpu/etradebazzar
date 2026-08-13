DROP INDEX "product_models_3d_productId_key";

ALTER TABLE "product_models_3d" ADD COLUMN "skuId" TEXT;

ALTER TABLE "product_models_3d" ADD CONSTRAINT "product_models_3d_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "product_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "product_models_3d_productId_skuId_key" ON "product_models_3d"("productId", "skuId");
CREATE INDEX "product_models_3d_skuId_idx" ON "product_models_3d"("skuId");

CREATE UNIQUE INDEX "product_models_3d_default_per_product"
  ON "product_models_3d"("productId") WHERE "skuId" IS NULL;

-- CustomerUploadAsset: additive skuId, no prior unique constraint to touch.
ALTER TABLE "customer_upload_assets" ADD COLUMN "skuId" TEXT;

ALTER TABLE "customer_upload_assets" ADD CONSTRAINT "customer_upload_assets_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "product_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "customer_upload_assets_skuId_idx" ON "customer_upload_assets"("skuId");

-- PrintArea: same treatment as ProductModel3D above.
DROP INDEX "PrintArea_productId_key";

ALTER TABLE "PrintArea" ADD COLUMN "skuId" TEXT;

ALTER TABLE "PrintArea" ADD CONSTRAINT "PrintArea_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "product_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PrintArea_productId_skuId_key" ON "PrintArea"("productId", "skuId");
CREATE INDEX "PrintArea_skuId_idx" ON "PrintArea"("skuId");

-- Partial index: at most one default (skuId IS NULL) print area per product.
CREATE UNIQUE INDEX "PrintArea_default_per_product"
  ON "PrintArea"("productId") WHERE "skuId" IS NULL;

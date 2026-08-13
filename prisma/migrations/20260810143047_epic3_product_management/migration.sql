-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'LIVE');

-- AlterTable: products - new columns (additive, safe)
ALTER TABLE "products"
  ADD COLUMN "specification" TEXT,
  ADD COLUMN "negotiationThresholdQty" INTEGER,
  ADD COLUMN "customizationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "customizationAcceptedFormats" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: products.status - preserving type change (see mapping above)
ALTER TABLE "products" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "status" TYPE "ProductStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'PENDING_APPROVAL'
    WHEN 'APPROVED' THEN 'LIVE'
    WHEN 'REJECTED' THEN 'REJECTED'
  END
)::"ProductStatus";
ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE INDEX IF NOT EXISTS "products_sellerId_status_idx" ON "products"("sellerId", "status");

-- AlterTable: customer_upload_assets - nullable productId, only set for
-- customization uploads scoped to a product.
ALTER TABLE "customer_upload_assets" ADD COLUMN "productId" TEXT;

-- CreateTable: sku_price_tiers
CREATE TABLE "sku_price_tiers" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: commission_proposals
CREATE TABLE "commission_proposals" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "proposedRate" DECIMAL(5,2) NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "proposedByType" TEXT NOT NULL,
    "status" "NegotiationStatus" NOT NULL DEFAULT 'PENDING',
    "round" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable: product_models_3d
CREATE TABLE "product_models_3d" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_models_3d_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sku_price_tiers_skuId_idx" ON "sku_price_tiers"("skuId");
CREATE UNIQUE INDEX "sku_price_tiers_skuId_minQty_key" ON "sku_price_tiers"("skuId", "minQty");
CREATE INDEX "commission_proposals_productId_idx" ON "commission_proposals"("productId");
CREATE UNIQUE INDEX "product_models_3d_productId_key" ON "product_models_3d"("productId");
CREATE INDEX "customer_upload_assets_productId_idx" ON "customer_upload_assets"("productId");

-- AddForeignKey
ALTER TABLE "sku_price_tiers" ADD CONSTRAINT "sku_price_tiers_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "product_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_proposals" ADD CONSTRAINT "commission_proposals_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_models_3d" ADD CONSTRAINT "product_models_3d_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_upload_assets" ADD CONSTRAINT "customer_upload_assets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION check_sku_price_tier_monotonic()
RETURNS TRIGGER AS $$
DECLARE
  base_price NUMERIC;
  prev_price NUMERIC;
  next_price NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."skuId"));

  IF NEW."minQty" < 2 THEN
    RAISE EXCEPTION 'SkuPriceTier.minQty must be >= 2 (qty=1 is covered by ProductSKU.price)';
  END IF;

  SELECT price INTO base_price FROM product_skus WHERE id = NEW."skuId";
  IF base_price IS NOT NULL AND NEW.price > base_price THEN
    RAISE EXCEPTION 'Tier price (%) cannot exceed the SKU base price (%) at qty=1', NEW.price, base_price;
  END IF;

  SELECT price INTO prev_price FROM sku_price_tiers
    WHERE "skuId" = NEW."skuId" AND "minQty" < NEW."minQty" AND id <> NEW.id
    ORDER BY "minQty" DESC LIMIT 1;
  IF prev_price IS NOT NULL AND NEW.price > prev_price THEN
    RAISE EXCEPTION 'Tier price (%) at minQty=% cannot exceed the price (%) of the tier at a lower minQty', NEW.price, NEW."minQty", prev_price;
  END IF;

  SELECT price INTO next_price FROM sku_price_tiers
    WHERE "skuId" = NEW."skuId" AND "minQty" > NEW."minQty" AND id <> NEW.id
    ORDER BY "minQty" ASC LIMIT 1;
  IF next_price IS NOT NULL AND NEW.price < next_price THEN
    RAISE EXCEPTION 'Tier price (%) at minQty=% cannot be less than the price (%) of the tier at a higher minQty', NEW.price, NEW."minQty", next_price;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sku_price_tier_monotonic_check
  BEFORE INSERT OR UPDATE ON sku_price_tiers
  FOR EACH ROW EXECUTE FUNCTION check_sku_price_tier_monotonic();

CREATE OR REPLACE FUNCTION check_sku_base_price_vs_tiers()
RETURNS TRIGGER AS $$
DECLARE
  min_tier_price NUMERIC;
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.id));
    SELECT price INTO min_tier_price FROM sku_price_tiers
      WHERE "skuId" = NEW.id ORDER BY "minQty" ASC LIMIT 1;
    IF min_tier_price IS NOT NULL AND min_tier_price > NEW.price THEN
      RAISE EXCEPTION 'Cannot set SKU price (%) below its lowest-quantity tier price (%) - update or remove that tier first', NEW.price, min_tier_price;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sku_base_price_vs_tiers_check
  BEFORE UPDATE ON product_skus
  FOR EACH ROW EXECUTE FUNCTION check_sku_base_price_vs_tiers();

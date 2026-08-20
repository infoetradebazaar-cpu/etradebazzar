-- AlterTable
ALTER TABLE "sku_price_tiers" ADD COLUMN "maxQty" INTEGER;

CREATE OR REPLACE FUNCTION check_sku_price_tier_monotonic()
RETURNS TRIGGER AS $$
DECLARE
  base_price NUMERIC;
  prev_price NUMERIC;
  next_price NUMERIC;
  prev_floor NUMERIC;
  next_floor NUMERIC;
  prev_max_qty INT;
  next_min_qty INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."skuId"));

  IF NEW."minQty" < 2 THEN
    RAISE EXCEPTION 'SkuPriceTier.minQty must be >= 2 (qty=1 is covered by ProductSKU.price)';
  END IF;

  IF NEW."maxQty" IS NOT NULL AND NEW."maxQty" < NEW."minQty" THEN
    RAISE EXCEPTION 'Tier maxQty (%) must be >= minQty (%)', NEW."maxQty", NEW."minQty";
  END IF;

  SELECT price INTO base_price FROM product_skus WHERE id = NEW."skuId";
  IF base_price IS NOT NULL AND NEW.price > base_price THEN
    RAISE EXCEPTION 'Tier price (%) cannot exceed the SKU base price (%) at qty=1', NEW.price, base_price;
  END IF;

  IF NEW."hiddenFloorPrice" IS NOT NULL AND NEW."hiddenFloorPrice" > NEW.price THEN
    RAISE EXCEPTION 'Tier hidden floor price (%) cannot exceed this tier''s visible price (%)', NEW."hiddenFloorPrice", NEW.price;
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

  IF NEW."hiddenFloorPrice" IS NOT NULL THEN
    SELECT "hiddenFloorPrice" INTO prev_floor FROM sku_price_tiers
      WHERE "skuId" = NEW."skuId" AND "minQty" < NEW."minQty" AND id <> NEW.id AND "hiddenFloorPrice" IS NOT NULL
      ORDER BY "minQty" DESC LIMIT 1;
    IF prev_floor IS NOT NULL AND NEW."hiddenFloorPrice" > prev_floor THEN
      RAISE EXCEPTION 'Tier hidden floor (%) at minQty=% cannot exceed the floor (%) of the tier at a lower minQty', NEW."hiddenFloorPrice", NEW."minQty", prev_floor;
    END IF;

    SELECT "hiddenFloorPrice" INTO next_floor FROM sku_price_tiers
      WHERE "skuId" = NEW."skuId" AND "minQty" > NEW."minQty" AND id <> NEW.id AND "hiddenFloorPrice" IS NOT NULL
      ORDER BY "minQty" ASC LIMIT 1;
    IF next_floor IS NOT NULL AND NEW."hiddenFloorPrice" < next_floor THEN
      RAISE EXCEPTION 'Tier hidden floor (%) at minQty=% cannot be less than the floor (%) of the tier at a higher minQty', NEW."hiddenFloorPrice", NEW."minQty", next_floor;
    END IF;
  END IF;

  IF NEW."maxQty" IS NOT NULL THEN
    SELECT "minQty" INTO next_min_qty FROM sku_price_tiers
      WHERE "skuId" = NEW."skuId" AND "minQty" > NEW."minQty" AND id <> NEW.id
      ORDER BY "minQty" ASC LIMIT 1;
    IF next_min_qty IS NOT NULL AND NEW."maxQty" >= next_min_qty THEN
      RAISE EXCEPTION 'Tier range [%, %] overlaps the next tier starting at minQty=%', NEW."minQty", NEW."maxQty", next_min_qty;
    END IF;
  END IF;

  SELECT "maxQty" INTO prev_max_qty FROM sku_price_tiers
    WHERE "skuId" = NEW."skuId" AND "minQty" < NEW."minQty" AND id <> NEW.id
    ORDER BY "minQty" DESC LIMIT 1;
  IF prev_max_qty IS NOT NULL AND prev_max_qty >= NEW."minQty" THEN
    RAISE EXCEPTION 'Tier at minQty=% overlaps the previous tier''s range ending at maxQty=%', NEW."minQty", prev_max_qty;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

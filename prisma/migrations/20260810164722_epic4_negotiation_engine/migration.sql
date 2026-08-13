-- CreateEnum
CREATE TYPE "NegotiationMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "NegotiationSessionStatus" AS ENUM ('PENDING', 'EXHAUSTED', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "sku_price_tiers" ADD COLUMN     "hiddenFloorPrice" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "negotiation_sessions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "mode" "NegotiationMode" NOT NULL,
    "status" "NegotiationSessionStatus" NOT NULL DEFAULT 'PENDING',
    "visibleTierPrice" DECIMAL(10,2) NOT NULL,
    "hiddenFloorPrice" DECIMAL(10,2),
    "round" INTEGER NOT NULL DEFAULT 0,
    "finalPrice" DECIMAL(10,2),
    "orderId" TEXT,
    "nudgeDueAt" TIMESTAMP(3),
    "nudgeSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "negotiation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_rounds" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "offeredPrice" DECIMAL(10,2) NOT NULL,
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "negotiation_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_chat_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "proposedTimeSlot" TIMESTAMP(3),
    "proposedBy" TEXT,
    "customerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "sellerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "negotiation_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_messages" (
    "id" TEXT NOT NULL,
    "chatSessionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_sessions_orderId_key" ON "negotiation_sessions"("orderId");
CREATE INDEX "negotiation_sessions_customerId_idx" ON "negotiation_sessions"("customerId");
CREATE INDEX "negotiation_sessions_sellerId_idx" ON "negotiation_sessions"("sellerId");
CREATE INDEX "negotiation_sessions_skuId_idx" ON "negotiation_sessions"("skuId");
CREATE INDEX "negotiation_sessions_nudgeDueAt_idx" ON "negotiation_sessions"("nudgeDueAt");
CREATE INDEX "negotiation_rounds_sessionId_idx" ON "negotiation_rounds"("sessionId");
CREATE UNIQUE INDEX "negotiation_rounds_sessionId_round_key" ON "negotiation_rounds"("sessionId", "round");
CREATE UNIQUE INDEX "negotiation_chat_sessions_sessionId_key" ON "negotiation_chat_sessions"("sessionId");
CREATE INDEX "negotiation_messages_chatSessionId_idx" ON "negotiation_messages"("chatSessionId");

CREATE UNIQUE INDEX "negotiation_sessions_active_unique"
  ON "negotiation_sessions" ("customerId", "skuId")
  WHERE "status" IN ('PENDING', 'EXHAUSTED');

-- AddForeignKey
ALTER TABLE "negotiation_rounds" ADD CONSTRAINT "negotiation_rounds_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "negotiation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "negotiation_chat_sessions" ADD CONSTRAINT "negotiation_chat_sessions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "negotiation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "negotiation_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION check_sku_price_tier_monotonic()
RETURNS TRIGGER AS $$
DECLARE
  base_price NUMERIC;
  prev_price NUMERIC;
  next_price NUMERIC;
  prev_floor NUMERIC;
  next_floor NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."skuId"));

  IF NEW."minQty" < 2 THEN
    RAISE EXCEPTION 'SkuPriceTier.minQty must be >= 2 (qty=1 is covered by ProductSKU.price)';
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "seller_negotiation_configs" ADD COLUMN "minImprovementPct" DECIMAL(5,4) NOT NULL DEFAULT 0.005;

ALTER TABLE "pricing_engine_constants" ADD COLUMN "minImprovementFloorRupees" DECIMAL(10,2) NOT NULL DEFAULT 5;

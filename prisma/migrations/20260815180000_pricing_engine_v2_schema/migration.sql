ALTER TABLE "negotiation_sessions" ADD COLUMN "formulaVersion" TEXT NOT NULL DEFAULT 'v1_linear';
ALTER TABLE "negotiation_sessions" ADD COLUMN "activeEngineFlags" JSONB;

CREATE TABLE "seller_negotiation_configs" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "category" TEXT,
    "gammaBase" DECIMAL(4,3) NOT NULL,
    "gammaMin" DECIMAL(4,3) NOT NULL,
    "gammaMax" DECIMAL(4,3) NOT NULL,
    "alpha" DECIMAL(4,3) NOT NULL,
    "beta" DECIMAL(4,3) NOT NULL,
    "delta" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "zeta" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "eta" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "setBy" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_negotiation_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_negotiation_configs_sellerId_category_effectiveFrom_key"
  ON "seller_negotiation_configs"("sellerId", "category", "effectiveFrom");
CREATE INDEX "seller_negotiation_configs_sellerId_idx" ON "seller_negotiation_configs"("sellerId");

CREATE TABLE "pricing_engine_config" (
    "id" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "enableVolatility" BOOLEAN NOT NULL DEFAULT false,
    "enableAdverseSelection" BOOLEAN NOT NULL DEFAULT false,
    "enableDynamicHorizon" BOOLEAN NOT NULL DEFAULT false,
    "enableRegimeAdj" BOOLEAN NOT NULL DEFAULT false,
    "enableOFI" BOOLEAN NOT NULL DEFAULT false,
    "enableRepeatMult" BOOLEAN NOT NULL DEFAULT false,
    "enableCrossSkuDemand" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "pricing_engine_config_pkey" PRIMARY KEY ("id")
);

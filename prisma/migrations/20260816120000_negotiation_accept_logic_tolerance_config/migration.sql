ALTER TABLE "seller_negotiation_configs" ADD COLUMN "tolerancePct" DECIMAL(4,3) NOT NULL DEFAULT 0.03;
ALTER TABLE "seller_negotiation_configs" ADD COLUMN "earlyExitMinRound" INTEGER NOT NULL DEFAULT 2;

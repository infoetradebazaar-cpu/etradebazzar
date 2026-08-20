ALTER TABLE "pricing_engine_config" ADD COLUMN "enableDemandDecay" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "pricing_engine_constants" (
    "id" TEXT NOT NULL,
    "kMin" DECIMAL(5,3) NOT NULL DEFAULT 1.1,
    "kMax" DECIMAL(5,3) NOT NULL DEFAULT 3.5,
    "kappa" DECIMAL(5,3) NOT NULL DEFAULT 0.6,
    "w0" DECIMAL(5,3) NOT NULL DEFAULT 0.5,
    "pExponent" DECIMAL(5,3) NOT NULL DEFAULT 1.5,
    "lambdaAdverse" DECIMAL(5,3) NOT NULL DEFAULT 0.6,
    "psiImpact" DECIMAL(5,3) NOT NULL DEFAULT 0.4,
    "muJitter" DECIMAL(5,3) NOT NULL DEFAULT 0.5,
    "jitterBaseFraction" DECIMAL(6,4) NOT NULL DEFAULT 0.02,
    "theta" DECIMAL(5,3) NOT NULL DEFAULT 0.5,
    "tau" DECIMAL(5,3) NOT NULL DEFAULT 1,
    "deltaMax" DECIMAL(5,3) NOT NULL DEFAULT 0.15,
    "rhoRepeat" DECIMAL(5,3) NOT NULL DEFAULT 0.1,
    "lambdaDecayPerDay" DECIMAL(6,4) NOT NULL DEFAULT 0.15,
    "crossSkuWeight" DECIMAL(5,3) NOT NULL DEFAULT 0.3,
    "demandColdStartThreshold" INTEGER NOT NULL DEFAULT 5,
    "volatilityShrinkageN0" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "pricing_engine_constants_pkey" PRIMARY KEY ("id")
);

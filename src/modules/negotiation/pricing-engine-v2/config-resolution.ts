import { db } from "../../../db/index";
import { redis } from "../../../db/redis";
import { logger } from "../../../utils/logger";
import {
  DEFAULT_ENGINE_CONSTANTS,
  DEFAULT_GAMMA_CONFIG,
  STAGE_0_CONFIG,
  type EngineConfig,
  type EngineConstants,
  type SellerGammaConfig,
} from "./types";

export async function resolveSellerGammaConfig(sellerId: string, category: string): Promise<SellerGammaConfig> {
  const now = new Date();

  const categoryConfig = await db.sellerNegotiationConfig.findFirst({
    where: { sellerId, category, effectiveFrom: { lte: now } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (categoryConfig) return toGammaConfig(categoryConfig);

  const sellerWideConfig = await db.sellerNegotiationConfig.findFirst({
    where: { sellerId, category: null, effectiveFrom: { lte: now } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (sellerWideConfig) return toGammaConfig(sellerWideConfig);

  return DEFAULT_GAMMA_CONFIG;
}

function toGammaConfig(row: {
  gammaBase: unknown;
  gammaMin: unknown;
  gammaMax: unknown;
  alpha: unknown;
  beta: unknown;
  delta: unknown;
  zeta: unknown;
  eta: unknown;
  tolerancePct: unknown;
  earlyExitMinRound: unknown;
  minImprovementPct: unknown;
}): SellerGammaConfig {
  return {
    gammaBase: Number(row.gammaBase),
    gammaMin: Number(row.gammaMin),
    gammaMax: Number(row.gammaMax),
    alpha: Number(row.alpha),
    beta: Number(row.beta),
    delta: Number(row.delta),
    zeta: Number(row.zeta),
    eta: Number(row.eta),
    tolerancePct: Number(row.tolerancePct),
    earlyExitMinRound: Number(row.earlyExitMinRound),
    minImprovementPct: Number(row.minImprovementPct),
  };
}

export async function resolveEngineConfig(): Promise<EngineConfig> {
  const row = await db.pricingEngineConfig.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!row) return STAGE_0_CONFIG;
  return {
    stage: row.stage,
    enableDemandDecay: row.enableDemandDecay,
    enableVolatility: row.enableVolatility,
    enableAdverseSelection: row.enableAdverseSelection,
    enableDynamicHorizon: row.enableDynamicHorizon,
    enableRegimeAdj: row.enableRegimeAdj,
    enableOFI: row.enableOFI,
    enableRepeatMult: row.enableRepeatMult,
    enableCrossSkuDemand: row.enableCrossSkuDemand,
  };
}

const CONSTANTS_CACHE_KEY = "neg-v2-constants";
const CONSTANTS_CACHE_TTL_SECONDS = 30; // same TTL as signal-cache.ts, changes rarely

function toEngineConstants(row: Record<string, unknown>): EngineConstants {
  return {
    kMin: Number(row.kMin),
    kMax: Number(row.kMax),
    kappa: Number(row.kappa),
    w0: Number(row.w0),
    pExponent: Number(row.pExponent),
    lambdaAdverse: Number(row.lambdaAdverse),
    psiImpact: Number(row.psiImpact),
    muJitter: Number(row.muJitter),
    jitterBaseFraction: Number(row.jitterBaseFraction),
    theta: Number(row.theta),
    tau: Number(row.tau),
    deltaMax: Number(row.deltaMax),
    rhoRepeat: Number(row.rhoRepeat),
    lambdaDecayPerDay: Number(row.lambdaDecayPerDay),
    crossSkuWeight: Number(row.crossSkuWeight),
    demandColdStartThreshold: Number(row.demandColdStartThreshold),
    volatilityShrinkageN0: Number(row.volatilityShrinkageN0),
    minImprovementFloorRupees: Number(row.minImprovementFloorRupees),
  };
}
export async function resolveEngineConstants(): Promise<EngineConstants> {
  try {
    const cached = await redis.get(CONSTANTS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (err: any) {
    logger.warn({ err: err.message }, "pricing-engine-v2 constants cache read failed");
  }

  let resolved: EngineConstants;
  try {
    const row = await db.pricingEngineConstants.findFirst({ orderBy: { updatedAt: "desc" } });
    resolved = row ? toEngineConstants(row) : DEFAULT_ENGINE_CONSTANTS;
  } catch (err: any) {
    logger.warn({ err: err.message }, "pricing-engine-v2 constants resolution failed, using hardcoded defaults");
    resolved = DEFAULT_ENGINE_CONSTANTS;
  }

  redis.setex(CONSTANTS_CACHE_KEY, CONSTANTS_CACHE_TTL_SECONDS, JSON.stringify(resolved)).catch(() => null);
  return resolved;
}

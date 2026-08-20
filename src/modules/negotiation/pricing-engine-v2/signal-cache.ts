import { redis } from "../../../db/redis";
import { db } from "../../../db/index";
import { logger } from "../../../utils/logger";
import { DEFAULT_ENGINE_CONSTANTS, NEUTRAL_SIGNALS, type EngineConfig, type EngineConstants, type EngineSignals } from "./types";
import { computeSigma } from "./volatility";
import { computeDemandScore, type DemandOutcome } from "./demand";
import { computeRegimeAdj } from "./regime";
import { computeOFI } from "./orderFlow";

const SIGNAL_CACHE_TTL_SECONDS = 30; // same pattern as recommendation.service.ts's cache
const SIGNAL_COMPUTE_TIMEOUT_MS = 400; // timeout/error -> NEUTRAL_SIGNALS, never block the request
// lookback windows, operational tuning not formula constants
const OFI_WINDOW_MS = 24 * 60 * 60 * 1000;
const REGIME_LOOKBACK_SESSIONS = 20; // M
const VOLATILITY_LOOKBACK_SESSIONS = 50; // N

type CachedAggregateSignals = Pick<EngineSignals, "sigma" | "demandScore" | "regimeAdj" | "ofi">;

const NEUTRAL_AGGREGATE: CachedAggregateSignals = {
  sigma: NEUTRAL_SIGNALS.sigma,
  demandScore: NEUTRAL_SIGNALS.demandScore,
  regimeAdj: NEUTRAL_SIGNALS.regimeAdj,
  ofi: NEUTRAL_SIGNALS.ofi,
};

function cacheKey(skuId: string): string {
  return `neg-v2-signals:${skuId}`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// the expensive path, never call without the cache/timeout guard above
async function computeFreshAggregateSignals(
  skuId: string,
  categoryId: string,
  engineConfig: EngineConfig,
  constants: EngineConstants,
): Promise<CachedAggregateSignals> {
  // no direct product relation on NegotiationSession, resolve category product IDs first
  const [ownAccepted, categoryProductIds, ofiRounds, crossSkuIds] = await Promise.all([
    db.negotiationSession.findMany({
      where: { skuId, status: "ACCEPTED", finalPrice: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: VOLATILITY_LOOKBACK_SESSIONS,
      select: { finalPrice: true, visibleTierPrice: true, updatedAt: true, status: true },
    }),
    engineConfig.enableVolatility
      ? db.product.findMany({ where: { categoryId }, select: { id: true } })
      : Promise.resolve([]),
    engineConfig.enableOFI
      ? db.negotiationRound.findMany({
          where: {
            session: { skuId },
            response: { not: null },
            respondedAt: { gte: new Date(Date.now() - OFI_WINDOW_MS) },
          },
          select: { response: true },
        })
      : Promise.resolve([]),
    // Stage 4 cross-SKU: sibling SKUs of the same product as the proxy "correlated" set
    engineConfig.enableCrossSkuDemand
      ? db.productSKU.findMany({
          where: { product: { skus: { some: { id: skuId } } }, id: { not: skuId } },
          select: { id: true },
          take: 10,
        })
      : Promise.resolve([]),
  ]);

  const categoryAccepted = categoryProductIds.length
    ? await db.negotiationSession.findMany({
        where: {
          productId: { in: categoryProductIds.map((p) => p.id) },
          status: "ACCEPTED",
          finalPrice: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        take: VOLATILITY_LOOKBACK_SESSIONS,
        select: { finalPrice: true, visibleTierPrice: true },
      })
    : [];

  const sigmaRaw = stddevDiscount(ownAccepted);
  const sigmaCategory = stddevDiscount(categoryAccepted) ?? 0;
  const sigma = computeSigma(
    { sigmaRaw, n: ownAccepted.length, n0: constants.volatilityShrinkageN0, sigmaCategory },
    engineConfig.enableVolatility,
  );

  const ownOutcomes = await toOutcomes(skuId);
  let crossSkuOutcomes: DemandOutcome[] | undefined;
  if (engineConfig.enableCrossSkuDemand && crossSkuIds.length > 0) {
    crossSkuOutcomes = (
      await Promise.all(crossSkuIds.map((s) => toOutcomes(s.id)))
    ).flat();
  }
  const demandScore = computeDemandScore({
    outcomes: ownOutcomes,
    crossSkuOutcomes,
    enableDemandDecay: engineConfig.enableDemandDecay,
    enableCrossSku: engineConfig.enableCrossSkuDemand,
    lambdaDecayPerDay: constants.lambdaDecayPerDay,
    coldStartThreshold: constants.demandColdStartThreshold,
    crossSkuWeight: constants.crossSkuWeight,
  });

  const recentDiscounts = ownAccepted
    .slice(0, REGIME_LOOKBACK_SESSIONS)
    .reverse() // regime.ts wants oldest first
    .map((s) => 1 - Number(s.finalPrice) / Number(s.visibleTierPrice));
  const regimeAdj = computeRegimeAdj(
    { recentDiscounts, tau: constants.tau, deltaMax: constants.deltaMax },
    engineConfig.enableRegimeAdj,
  );

  const accepts = ofiRounds.filter((r) => r.response === "ACCEPT").length;
  const rejects = ofiRounds.filter((r) => r.response === "REJECT").length;
  const ofi = computeOFI({ recentAccepts: accepts, recentRejects: rejects }, engineConfig.enableOFI);

  return { sigma, demandScore, regimeAdj, ofi };
}

function stddevDiscount(
  sessions: { finalPrice: unknown; visibleTierPrice: unknown }[],
): number | null {
  if (sessions.length === 0) return null;
  const discounts = sessions.map((s) => 1 - Number(s.finalPrice) / Number(s.visibleTierPrice));
  const mean = discounts.reduce((a, b) => a + b, 0) / discounts.length;
  const variance = discounts.reduce((a, b) => a + (b - mean) ** 2, 0) / discounts.length;
  return Math.sqrt(variance);
}

async function toOutcomes(skuId: string): Promise<DemandOutcome[]> {
  const sessions = await db.negotiationSession.findMany({
    where: { skuId, status: { in: ["ACCEPTED", "REJECTED"] } },
    orderBy: { updatedAt: "desc" },
    take: VOLATILITY_LOOKBACK_SESSIONS,
    select: { status: true, updatedAt: true },
  });
  const now = Date.now();
  return sessions.map((s) => ({
    accepted: s.status === "ACCEPTED",
    ageMs: now - s.updatedAt.getTime(),
  }));
}

// cache-first accessor for the 4 aggregate signals. stockPressure/isRepeatRejection are NOT
// cached here — they're per-request (customer/quantity specific), see resolveEngineSignals below
export async function getCachedAggregateSignals(
  skuId: string,
  categoryId: string,
  engineConfig: EngineConfig,
  constants: EngineConstants = DEFAULT_ENGINE_CONSTANTS,
): Promise<CachedAggregateSignals> {
  const key = cacheKey(skuId);
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch (err: any) {
    logger.warn({ err: err.message, skuId }, "pricing-engine-v2 signal cache read failed");
  }

  const fresh = await withTimeout(
    computeFreshAggregateSignals(skuId, categoryId, engineConfig, constants).catch((err: any) => {
      logger.warn({ err: err.message, skuId }, "pricing-engine-v2 signal computation failed");
      return NEUTRAL_AGGREGATE;
    }),
    SIGNAL_COMPUTE_TIMEOUT_MS,
    NEUTRAL_AGGREGATE,
  );

  redis.setex(key, SIGNAL_CACHE_TTL_SECONDS, JSON.stringify(fresh)).catch(() => null);
  return fresh;
}

// full EngineSignals for a round: cached aggregates + fresh per-request fields
export async function resolveEngineSignals(params: {
  skuId: string;
  categoryId: string;
  customerId: string;
  quantity: number;
  engineConfig: EngineConfig;
  constants?: EngineConstants;
}): Promise<EngineSignals> {
  const [aggregate, sku, priorRejection] = await Promise.all([
    getCachedAggregateSignals(params.skuId, params.categoryId, params.engineConfig, params.constants),
    db.productSKU.findUnique({ where: { id: params.skuId }, select: { stock: true } }),
    params.engineConfig.enableRepeatMult
      ? db.negotiationSession.findFirst({
          where: { skuId: params.skuId, customerId: params.customerId, status: "REJECTED" },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const stock = sku?.stock ?? 0;
  const stockPressure = params.quantity > 0 ? Math.max(0, Math.min(1, 1 - stock / params.quantity)) : 1;

  return {
    ...aggregate,
    stockPressure,
    isRepeatRejection: priorRejection !== null,
  };
}

// shared types for pricing-engine-v2, see engine.ts for the orchestrator

// 8 flags total: Stage 1 (1), Stage 2 (1), Stage 3 (1), Stage 4 (5) — see PricingEngineConfig in schema.prisma
export interface PricingEngineFlags {
  enableDemandDecay: boolean;
  enableVolatility: boolean;
  enableAdverseSelection: boolean;
  enableDynamicHorizon: boolean;
  enableRegimeAdj: boolean;
  enableOFI: boolean;
  enableRepeatMult: boolean;
  enableCrossSkuDemand: boolean;
}

export const NO_OP_FLAGS: PricingEngineFlags = {
  enableDemandDecay: false,
  enableVolatility: false,
  enableAdverseSelection: false,
  enableDynamicHorizon: false,
  enableRegimeAdj: false,
  enableOFI: false,
  enableRepeatMult: false,
  enableCrossSkuDemand: false,
};

export interface EngineConfig extends PricingEngineFlags {
  stage: number; // 0-4
}

export const STAGE_0_CONFIG: EngineConfig = { stage: 0, ...NO_OP_FLAGS };

// per-seller risk weights + accept-decision tuning, both from SellerNegotiationConfig
export interface SellerGammaConfig {
  gammaBase: number;
  gammaMin: number;
  gammaMax: number;
  alpha: number; // stock-pressure weight
  beta: number; // demand weight
  delta: number; // volatility weight - Stage 2
  zeta: number; // regime weight - Stage 4
  eta: number; // OFI weight - Stage 4
  tolerancePct: number; // Case 2 early-exit band, e.g. 0.03 = 3%
  earlyExitMinRound: number; // Case 2 cannot trigger before this round
  minImprovementPct: number; // momentum gate rate side, see momentum-gate.ts
}

// platform default when a seller has no config row, conservative on purpose
export const DEFAULT_GAMMA_CONFIG: SellerGammaConfig = {
  gammaBase: 0.35,
  gammaMin: 0.05,
  gammaMax: 0.9,
  alpha: 0.3,
  beta: 0.3,
  delta: 0,
  zeta: 0,
  eta: 0,
  tolerancePct: 0.03,
  earlyExitMinRound: 2,
  minImprovementPct: 0.005, // 0.5% of (V-F)
};

// resolved per-SKU market signals, computed by signal-cache.ts — engine itself never hits the DB
export interface EngineSignals {
  stockPressure: number; // 0..1, 1 = scarce relative to requested qty
  demandScore: number; // 0..1, recency-weighted acceptance rate (or flat average pre-Stage-1)
  sigma: number; // volatility of (1 - finalPrice/V) over recent accepted sessions, this SKU
  regimeAdj: number; // clamped discount-trend adjustment, can be negative
  ofi: number; // -1..1, recent accept/reject imbalance
  isRepeatRejection: boolean; // customer has a prior REJECTED session on this SKU
}

// fallback when a cached signal is missing/stale, keeps every disabled term at its no-op value
export const NEUTRAL_SIGNALS: EngineSignals = {
  stockPressure: 0.5,
  demandScore: 0.5,
  sigma: 0,
  regimeAdj: 0,
  ofi: 0,
  isRepeatRejection: false,
};

export interface OfferInputs {
  sessionId: string;
  skuId: string;
  createdAt: Date;
  visiblePrice: number; // V
  hiddenFloorPrice: number; // F
  round: number; // r, 1-indexed
  customerPrice?: number; // C
  previousOfferedPrices: number[]; // offeredPrice(r-1), (r-2)... most recent first, for priceImpact
  // customerPrice(1)..customerPrice(r-1), chronological (opposite order from above, on purpose).
  // length must equal round-1 or momentum-gate.ts can't line rounds up right. optional so old call sites still typecheck.
  previousCustomerPrices?: (number | undefined)[];
}

// every structural formula constant (17), fallback when no PricingEngineConstants row exists / DB read fails
export interface EngineConstants {
  kMin: number;
  kMax: number;
  kappa: number;
  w0: number;
  pExponent: number;
  lambdaAdverse: number;
  psiImpact: number;
  muJitter: number;
  jitterBaseFraction: number;
  theta: number;
  tau: number;
  deltaMax: number;
  rhoRepeat: number;
  lambdaDecayPerDay: number;
  crossSkuWeight: number;
  demandColdStartThreshold: number;
  volatilityShrinkageN0: number;
  minImprovementFloorRupees: number; // momentum gate absolute floor, see SellerGammaConfig.minImprovementPct
}

export const DEFAULT_ENGINE_CONSTANTS: EngineConstants = {
  kMin: 1.1,
  kMax: 3.5,
  kappa: 0.6,
  w0: 0.5,
  pExponent: 1.5,
  lambdaAdverse: 0.6,
  psiImpact: 0.4,
  muJitter: 0.5,
  jitterBaseFraction: 0.02,
  theta: 0.5,
  tau: 1,
  deltaMax: 0.15,
  rhoRepeat: 0.1,
  lambdaDecayPerDay: 0.15,
  crossSkuWeight: 0.3,
  demandColdStartThreshold: 5,
  volatilityShrinkageN0: 10,
  minImprovementFloorRupees: 5,
};

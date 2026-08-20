import { deriveSeed, seedFloat } from "./seed";
import { computeGamma } from "./gamma";
import { computeDynamicR } from "./horizon";
import { computeAdverseSignal, computePriceImpact } from "./adverseSelection";
import { DEFAULT_ENGINE_CONSTANTS, type EngineConfig, type EngineConstants, type EngineSignals, type OfferInputs, type SellerGammaConfig } from "./types";
import { computeMomentumState } from "../momentum-gate";
import { PREMIUM_STRETCH_PCT } from "../legacy-linear-formula";

export interface OfferResult {
  offeredPrice: number;
  effectiveR: number;
  gamma: number;
  k: number;
  t: number;
  isFinalRound: boolean;
  effectiveT: number;
  everMovedForward: boolean;
  genuineMomentumThisRound: boolean;
  skewedFloor: number;
  baseOffer: number;
  clampedCustomerPrice: number;
  adverseSignal: number;
  priceImpact: number;
  customerInfluenceWeight: number; // w(r)
  blendedPreJitter: number;
  jitter: number;
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function clampBetween(x: number, a: number, b: number): number {
  return clamp(x, Math.min(a, b), Math.max(a, b));
}

function roundToRupee(x: number): number {
  return Math.round(x);
}

/**
 * Pure function deterministic given inputs (seeded via deriveSeed/seedFloat).
 *
 *   skewedFloor(r) = F + gamma(r)*(V-F)*(1-effectiveT(r))
 *   baseOffer(r)   = V - (V-skewedFloor(r))*effectiveT(r)^k
 *   w(r)           = w0*(1-t(r))^p * (1-lambda*adverseSignal(r)) * (1-psi*priceImpact(r))
 *   blended        = baseOffer(r)*(1-w(r)) + clampedC*w(r)
 *   offeredPrice   = round(clamp(blended + jitter(r), F, V))
 *
 * effectiveT caps at (genuine rounds so far)/R* (momentum-gate.ts) hits
 * exactly F on its own once effectiveT reaches 1, no separate final-round
 * override needed. w(r)/jitter still key off raw t.
 */
export function computeOfferV2(
  inputs: OfferInputs,
  sellerConfig: SellerGammaConfig,
  engineConfig: EngineConfig,
  signals: EngineSignals,
  rBase: number,
  constants: EngineConstants = DEFAULT_ENGINE_CONSTANTS,
): OfferResult {
  const { visiblePrice: V, hiddenFloorPrice: F, round: r, customerPrice: C } = inputs;

  if (V <= F) {
    return {
      offeredPrice: roundToRupee(F),
      effectiveR: rBase,
      gamma: sellerConfig.gammaBase,
      k: constants.kMin,
      t: 1,
      isFinalRound: true,
      effectiveT: 1,
      everMovedForward: true,
      genuineMomentumThisRound: true,
      skewedFloor: F,
      baseOffer: F,
      clampedCustomerPrice: F,
      adverseSignal: 0,
      priceImpact: 0,
      customerInfluenceWeight: 0,
      blendedPreJitter: F,
      jitter: 0,
    };
  }

  const seed = deriveSeed(inputs.sessionId, inputs.skuId, inputs.createdAt);
  const kRand = seedFloat(seed, "curve");
  const jRand = seedFloat(seed, "jitter", r);

  const effectiveR = computeDynamicR(
    { rBase, stockPressure: signals.stockPressure, theta: constants.theta },
    engineConfig.enableDynamicHorizon,
  );
  const t = Math.min(1, r / effectiveR);

  // effectiveT drives skewedFloor/baseOffer below, capped at 1/effectiveR per genuine round
  const minImprovement = Math.max(constants.minImprovementFloorRupees, sellerConfig.minImprovementPct * (V - F));
  const { effectiveT, everMovedForward, genuineThisRound } = computeMomentumState(
    [...(inputs.previousCustomerPrices ?? []), C],
    (round) => Math.min(1, round / effectiveR),
    minImprovement,
    effectiveR,
  );

  const gamma = computeGamma({ sellerConfig, signals, engineConfig, rhoRepeat: constants.rhoRepeat });
  const k = clamp(1.6 + 0.8 * kRand + constants.kappa * signals.sigma, constants.kMin, constants.kMax);

  const isPremiumZone = C !== undefined && C >= V;
  const zoneStart = isPremiumZone ? C! * (1 + PREMIUM_STRETCH_PCT) : V;
  const zoneEnd = isPremiumZone ? C! : F;
  const zoneMin = Math.min(zoneStart, zoneEnd);
  const zoneMax = Math.max(zoneStart, zoneEnd);

  const skewedFloor = zoneEnd + gamma * (zoneStart - zoneEnd) * (1 - effectiveT);
  const baseOffer = zoneStart - (zoneStart - skewedFloor) * Math.pow(effectiveT, k);

  const clampedC = C !== undefined ? clampBetween(C, zoneMin, zoneMax) : baseOffer;

  const adverseSignal = computeAdverseSignal(
    { visiblePrice: V, hiddenFloorPrice: F, clampedCustomerPrice: clampedC, t },
    engineConfig.enableAdverseSelection,
  );
  const priceImpact = computePriceImpact(
    { visiblePrice: V, hiddenFloorPrice: F, previousOfferedPrices: inputs.previousOfferedPrices },
    engineConfig.enableAdverseSelection,
  );

  const w =
    C === undefined
      ? 0
      : constants.w0 *
        Math.pow(1 - t, constants.pExponent) *
        (1 - constants.lambdaAdverse * adverseSignal) *
        (1 - constants.psiImpact * priceImpact);

  const blended = baseOffer * (1 - w) + clampedC * w;

  const jitter =
    (jRand - 0.5) * 2 * constants.jitterBaseFraction * (zoneMax - zoneMin) * (1 - t) * (1 + constants.muJitter * signals.sigma);

  const offeredPrice = roundToRupee(clamp(blended + jitter, zoneMin, zoneMax));

  const isFinalRound = r >= effectiveR;

  return {
    offeredPrice,
    effectiveR,
    gamma,
    k,
    t,
    isFinalRound,
    effectiveT,
    everMovedForward,
    genuineMomentumThisRound: genuineThisRound,
    skewedFloor,
    baseOffer,
    clampedCustomerPrice: clampedC,
    adverseSignal,
    priceImpact,
    customerInfluenceWeight: w,
    blendedPreJitter: blended,
    jitter,
  };
}

import type { EngineConfig, EngineSignals, SellerGammaConfig } from "./types";

// rho not seller-configurable yet, no schema field for it
const DEFAULT_RHO_REPEAT = 0.1;

export interface GammaInputs {
  sellerConfig: SellerGammaConfig;
  signals: EngineSignals;
  engineConfig: EngineConfig;
  rhoRepeat?: number;
}

// risk aversion for this round. gamma = base*repeatMult + alpha*stock - beta*demand + delta*sigma + zeta*regime + eta*ofi,
// clamped to [min, max]. every extra term is 0/1 (no-op) when its flag is off, reduces to Stage 0 core formula.
export function computeGamma(inputs: GammaInputs): number {
  const { sellerConfig, signals, engineConfig } = inputs;
  const rhoRepeat = inputs.rhoRepeat ?? DEFAULT_RHO_REPEAT;

  const repeatMult =
    engineConfig.enableRepeatMult && signals.isRepeatRejection ? 1 + rhoRepeat : 1;

  const raw =
    sellerConfig.gammaBase * repeatMult +
    sellerConfig.alpha * signals.stockPressure -
    sellerConfig.beta * signals.demandScore +
    sellerConfig.delta * signals.sigma +
    sellerConfig.zeta * signals.regimeAdj +
    sellerConfig.eta * signals.ofi;

  return Math.max(sellerConfig.gammaMin, Math.min(sellerConfig.gammaMax, raw));
}

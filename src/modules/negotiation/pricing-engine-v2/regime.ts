// Stage 4, no-op returns 0 (zeroes zeta*regimeAdj in gamma.ts)

const DEFAULT_TAU = 1;
const DEFAULT_DELTA_MAX = 0.15;

export interface RegimeInputs {
  recentDiscounts: number[]; // discount% per accepted session, oldest first
  tau?: number;
  deltaMax?: number;
}

function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - xMean) * (values[i]! - yMean);
    den += (xs[i]! - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// discounts trending up -> push gamma up (more conservative) to counteract it, clamped to +-deltaMax
export function computeRegimeAdj(inputs: RegimeInputs, enabled: boolean): number {
  if (!enabled) return 0;
  const tau = inputs.tau ?? DEFAULT_TAU;
  const deltaMax = inputs.deltaMax ?? DEFAULT_DELTA_MAX;
  const slope = linearRegressionSlope(inputs.recentDiscounts);
  return Math.max(-deltaMax, Math.min(deltaMax, slope * tau));
}

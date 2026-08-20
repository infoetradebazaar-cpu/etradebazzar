// Stage 2, no-op returns 0 (zeroes delta*sigma in gamma.ts + jitter/horizon widening)

export interface VolatilityInputs {
  sigmaRaw: number | null; // stddev(1 - finalPrice/V) over last N accepted sessions, this SKU. null = no data yet
  n: number; // sample size behind sigmaRaw
  n0: number; // shrinkage prior strength, bigger = more weight on category avg while n is small
  sigmaCategory: number; // shrinkage target
}

// Bayesian shrinkage toward category avg when this SKU's sample is thin (cold start).
// sigma = n/(n+n0)*sigmaRaw + n0/(n+n0)*sigmaCategory
export function computeSigma(inputs: VolatilityInputs, enabled: boolean): number {
  if (!enabled) return 0;
  const { sigmaRaw, n, n0, sigmaCategory } = inputs;
  if (sigmaRaw === null || n <= 0) return sigmaCategory;
  if (n0 <= 0) return sigmaRaw;
  const weight = n / (n + n0);
  return weight * sigmaRaw + (1 - weight) * sigmaCategory;
}

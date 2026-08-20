// demandScore itself is core (never off) recency decay is what's Stage-1-gated,
// lambdaDecayPerDay forced to 0 when the flag's off (plain avg). cross-SKU blend is Stage 4.

export const DEFAULT_LAMBDA_DECAY_PER_DAY = 0.15; // fallback, live value comes from PricingEngineConstants
const DEFAULT_COLD_START_THRESHOLD = 5;
const DEFAULT_CROSS_SKU_WEIGHT = 0.3;

export interface DemandOutcome {
  accepted: boolean;
  ageMs: number;
}

export interface DemandInputs {
  outcomes: DemandOutcome[];
  crossSkuOutcomes?: DemandOutcome[];
  enableDemandDecay: boolean;
  enableCrossSku: boolean;
  lambdaDecayPerDay?: number; // tunable value to use WHEN enableDemandDecay is true
  coldStartThreshold?: number;
  crossSkuWeight?: number;
}

function weightedScore(outcomes: DemandOutcome[], lambdaDecayPerDay: number): number | null {
  if (outcomes.length === 0) return null;
  let weightSum = 0;
  let outcomeSum = 0;
  for (const o of outcomes) {
    const ageDays = o.ageMs / 86_400_000;
    const w = Math.exp(-lambdaDecayPerDay * ageDays);
    weightSum += w;
    outcomeSum += w * (o.accepted ? 1 : 0);
  }
  return weightSum > 0 ? outcomeSum / weightSum : null;
}

export function computeDemandScore(inputs: DemandInputs): number {
  const lambdaDecayPerDay = inputs.enableDemandDecay
    ? (inputs.lambdaDecayPerDay ?? DEFAULT_LAMBDA_DECAY_PER_DAY)
    : 0;
  const coldStartThreshold = inputs.coldStartThreshold ?? DEFAULT_COLD_START_THRESHOLD;
  const crossSkuWeight = inputs.crossSkuWeight ?? DEFAULT_CROSS_SKU_WEIGHT;

  const ownScore = weightedScore(inputs.outcomes, lambdaDecayPerDay);

  const coldStart = inputs.outcomes.length < coldStartThreshold;
  if (!inputs.enableCrossSku || !coldStart || !inputs.crossSkuOutcomes) {
    return ownScore ?? 0.5;
  }

  const crossScore = weightedScore(inputs.crossSkuOutcomes, lambdaDecayPerDay);
  if (ownScore === null) return crossScore ?? 0.5;
  if (crossScore === null) return ownScore;
  return ownScore * (1 - crossSkuWeight) + crossScore * crossSkuWeight;
}

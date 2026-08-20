// Stage 4, no-op returns rBase when disabled (same length as v1's MAX_ROUNDS)
const DEFAULT_THETA = 0.5;
const MIN_STOCK_PRESSURE = 0.05; // avoid division blowup near 0
const MAX_ROUNDS_CAP = 10;

export interface HorizonInputs {
  rBase: number;
  stockPressure: number; // 0..1, 1 = scarce
  theta?: number;
}

// scarce stock -> R* stays near rBase, close the deal fast. abundant stock -> R* grows, more patience.
export function computeDynamicR(inputs: HorizonInputs, enabled: boolean): number {
  if (!enabled) return inputs.rBase;
  const theta = inputs.theta ?? DEFAULT_THETA;
  const stockPressure = Math.max(MIN_STOCK_PRESSURE, inputs.stockPressure);
  const r = Math.round(inputs.rBase * (1 + theta / stockPressure));
  return Math.min(MAX_ROUNDS_CAP, Math.max(inputs.rBase, r));
}

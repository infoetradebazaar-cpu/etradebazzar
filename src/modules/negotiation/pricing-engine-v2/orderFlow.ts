// Stage 4, no-op returns 0 (zeroes eta*OFI in gamma.ts)

export interface OrderFlowInputs {
  recentAccepts: number; // this SKU, recent window
  recentRejects: number;
}

// accept/reject imbalance in [-1, 1], positive = accepting more lately
export function computeOFI(inputs: OrderFlowInputs, enabled: boolean): number {
  if (!enabled) return 0;
  const total = inputs.recentAccepts + inputs.recentRejects;
  if (total === 0) return 0;
  return (inputs.recentAccepts - inputs.recentRejects) / total;
}

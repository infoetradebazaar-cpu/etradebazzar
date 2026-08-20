const FULL_CONCESSION_EPSILON = 1e-9; // float slack for summed 1/maxRounds steps hitting 1.0

export interface MomentumResult {
  // curve progress, capped to at most (genuine rounds so far) / maxRounds
  effectiveT: number;
  // true once effectiveT has climbed all the way to 1 (full concession actually earned)
  everMovedForward: boolean;
  // was this round's move genuine (for display only)
  genuineThisRound: boolean;
}

// customerPriceHistory: cp(1)..cp(r), chronological, last entry is this round
// rawT: unfrozen progress fraction for a given round
// minImprovement: min rupee bump that counts as a real move
// maxRounds: caps how much effectiveT can advance per genuine round (1/maxRounds each)
export function computeMomentumState(
  customerPriceHistory: (number | undefined)[],
  rawT: (round: number) => number,
  minImprovement: number,
  maxRounds: number,
): MomentumResult {
  const r = customerPriceHistory.length;
  const step = 1 / maxRounds;
  if (r === 0) {
    const t1 = rawT(1);
    return { effectiveT: t1, everMovedForward: t1 >= 1 - FULL_CONCESSION_EPSILON, genuineThisRound: true };
  }

  let effectiveT = rawT(1);
  let genuineThisRound = true; // round 1

  for (let round = 2; round <= r; round++) {
    const cp = customerPriceHistory[round - 1];
    const prevCp = customerPriceHistory[round - 2];
    // First-ever offer counts as genuine; otherwise require a real improvement.
    genuineThisRound = cp !== undefined && (prevCp === undefined || cp - prevCp >= minImprovement);
    if (genuineThisRound) {
      // advance by at most one round's worth per genuine round — never jump to the clock's current position
      effectiveT = Math.min(rawT(round), effectiveT + step);
    }
  }

  return { effectiveT, everMovedForward: effectiveT >= 1 - FULL_CONCESSION_EPSILON, genuineThisRound };
}

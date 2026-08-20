export type AcceptCase = 1 | 2 | 3;

export interface AcceptDecision {
  finalPrice: number;
  acceptCase: AcceptCase;
  debugLabel: string;
}
export type NegotiationOutcome =
  | { outcome: "accept"; decision: AcceptDecision }
  | { outcome: "rejected" }
  | { outcome: "continue" };

export function decideAcceptOutcome(params: {
  action: "ACCEPT" | "REJECT";
  customerPrice: number | undefined;
  currentOfferedPrice: number;
  visiblePrice: number;
  floorPrice: number;
  round: number;
  maxRounds: number;
  tolerancePct: number;
  earlyExitMinRound: number;
  everMovedForward?: boolean;
  bestPriorCustomerOffer?: number;
}): NegotiationOutcome {
  if (params.action !== "REJECT") return { outcome: "continue" };
  const {
    customerPrice,
    currentOfferedPrice,
    visiblePrice,
    floorPrice,
    round,
    maxRounds,
    tolerancePct,
    earlyExitMinRound,
    everMovedForward = true,
    bestPriorCustomerOffer,
  } = params;

  const ceiling = Math.max(visiblePrice, currentOfferedPrice, customerPrice ?? -Infinity);
  const clamp = (price: number) =>
    Math.round(Math.min(ceiling, bestPriorCustomerOffer !== undefined ? Math.max(price, bestPriorCustomerOffer) : price));

  if (customerPrice !== undefined && customerPrice >= currentOfferedPrice) {
    return {
      outcome: "accept",
      decision: {
        finalPrice: clamp(customerPrice),
        acceptCase: 1,
        debugLabel: "Case 1 customer's counter meets/beats our ask: capture the customer's number (capped at their own bid, or visible if they bid below it)",
      },
    };
  }

  if (
    customerPrice !== undefined &&
    currentOfferedPrice - customerPrice <= currentOfferedPrice * tolerancePct &&
    currentOfferedPrice <= Math.max(visiblePrice, customerPrice) &&
    round >= earlyExitMinRound
  ) {
    return {
      outcome: "accept",
      decision: {
        finalPrice: clamp(currentOfferedPrice),
        acceptCase: 2,
        debugLabel: "Case 2 within tolerance and round >= earlyExitMinRound: early-exit at OUR ask, not the customer's lower number",
      },
    };
  }

  if (round >= maxRounds) {
    const isPremiumBid = customerPrice !== undefined && customerPrice >= visiblePrice;
    if (customerPrice !== undefined && customerPrice >= floorPrice && (everMovedForward || isPremiumBid)) {
      return {
        outcome: "accept",
        decision: {
          finalPrice: clamp(customerPrice),
          acceptCase: 3,
          debugLabel: isPremiumBid
            ? "Case 3 (Option B, premium) final round, customer's counter is still at/above visible: capture it outright, no momentum requirement any premium bid already beats list"
            : "Case 3 (Option B) final round, genuine qualifying counter (>= floor) submitted THIS round, and the customer showed real forward movement somewhere in the session: capture the customer's number",
        },
      };
    }
    return { outcome: "rejected" };
  }

  return { outcome: "continue" };
}

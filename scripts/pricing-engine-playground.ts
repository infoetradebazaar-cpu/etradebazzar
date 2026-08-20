import * as readline from "node:readline/promises";
import { interpolateOffer, MAX_ROUNDS } from "../src/modules/negotiation/legacy-linear-formula";
import { decideAcceptOutcome, type NegotiationOutcome } from "../src/modules/negotiation/accept-decision";
import { computeMomentumState } from "../src/modules/negotiation/momentum-gate";
import { computeOfferV2, type OfferResult } from "../src/modules/negotiation/pricing-engine-v2/engine";
import { DEFAULT_ENGINE_CONSTANTS, DEFAULT_GAMMA_CONFIG, NEUTRAL_SIGNALS, STAGE_0_CONFIG, type EngineConstants, type EngineSignals, type OfferInputs, type SellerGammaConfig } from "../src/modules/negotiation/pricing-engine-v2/types";
import { checkOfferValidity } from "../src/modules/negotiation/pricing-engine-v2/validate";

const PLAYGROUND_CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const PLAYGROUND_SKU_ID = "playground-sku";

type Flags = Record<string, string | boolean>;

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) {
      flags[arg.slice(2)] = true;
    } else {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return flags;
}

function num(flags: Flags, key: string, fallback?: number): number | undefined {
  const v = flags[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number, got: ${v}`);
  return n;
}

function str(flags: Flags, key: string, fallback?: string): string | undefined {
  const v = flags[key];
  if (v === undefined) return fallback;
  return typeof v === "string" ? v : String(v);
}

function randomSessionId(): string {
  return `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parsePreviousCustomerPrices(flags: Flags, key = "previousCustomerPrices"): (number | undefined)[] {
  const raw = str(flags, key);
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const trimmed = part.trim();
    if (trimmed === "" || trimmed === "-") return undefined;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) throw new Error(`--${key} must be a comma-separated list of numbers (or "-" for no price that round), got: ${part}`);
    return n;
  });
}

function resolveMinImprovement(visible: number, floor: number, sellerConfig: SellerGammaConfig, constants: EngineConstants): number {
  return Math.max(constants.minImprovementFloorRupees, sellerConfig.minImprovementPct * (visible - floor));
}

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.abs(n).toFixed(2)}`;
}

function section(title: string) {
  console.log(`\n${"─".repeat(2)} ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

function printAcceptDecision(
  offeredPrice: number,
  round: number,
  maxRounds: number,
  visible: number,
  floor: number,
  customerPrice: number | undefined,
  tolerancePct: number,
  earlyExitMinRound: number,
  everMovedForward: boolean,
  bestPriorCustomerOffer: number | undefined,
): NegotiationOutcome {
  const evaluation = decideAcceptOutcome({
    action: "REJECT",
    customerPrice,
    currentOfferedPrice: offeredPrice,
    visiblePrice: visible,
    floorPrice: floor,
    round,
    maxRounds,
    tolerancePct,
    earlyExitMinRound,
    everMovedForward,
    bestPriorCustomerOffer,
  });
  console.log(`\n  If the customer REJECTs this offer with this customerPrice on THIS round:`);
  if (evaluation.outcome === "accept") {
    console.log(`  ACCEPT ${evaluation.decision.debugLabel}`);
    console.log(`    finalPrice would be ${money(evaluation.decision.finalPrice)}`);
  } else if (evaluation.outcome === "rejected") {
    const reason =
      customerPrice === undefined
        ? "customerPrice was not provided"
        : !everMovedForward
          ? `customerPrice (${money(customerPrice)}) clears the absolute floor but the customer never showed genuine forward momentum (see effectiveT below) the momentum gate withholds the floor override`
          : `customerPrice (${money(customerPrice)}) is below the floor`;
    console.log(
      `  REJECTED (terminal) final round, and ${reason}. Session moves to REJECTED: 24h nudgeDueAt set, eligible for manual-negotiation fallback.`,
    );
  } else if (customerPrice === undefined) {
    console.log(`  No customerPrice given nothing to evaluate against Cases 1-3, Case 4 (continue) applies by default once they do counter.`);
  } else {
    console.log(
      `  Case 4 continues negotiating (customerPrice ${money(customerPrice)} doesn't satisfy Case 1 or 2, and round ${round} < maxRounds ${maxRounds}).`,
    );
  }
  return evaluation;
}

interface V1OfferResult {
  offeredPrice: number;
  effectiveT: number;
  t: number;
  everMovedForward: boolean;
  bestPriorCustomerOffer: number | undefined;
}

function computeAndPrintV1Offer(
  visible: number,
  floor: number,
  round: number,
  maxRounds: number,
  customerPrice: number | undefined,
  previousCustomerPrices: (number | undefined)[],
  minImprovement: number,
): V1OfferResult {
  const offeredPrice = interpolateOffer(visible, floor, round, customerPrice, previousCustomerPrices, minImprovement);

  const t = round / maxRounds;
  const { effectiveT, everMovedForward } = computeMomentumState(
    [...previousCustomerPrices, customerPrice],
    (r) => r / maxRounds,
    minImprovement,
    maxRounds,
  );
  const definedPriorOffers = previousCustomerPrices.filter((p): p is number => p !== undefined);
  const bestPriorCustomerOffer = definedPriorOffers.length ? Math.max(...definedPriorOffers) : undefined;

  section(`v1_linear (round ${round} of ${maxRounds})`);
  const interpolated = visible - (visible - floor) * effectiveT;
  console.log(`  Visible: ${money(visible)}   Floor: ${money(floor)}   Customer offered: ${customerPrice !== undefined ? money(customerPrice) : "(none)"}`);
  if (effectiveT === t) {
    console.log(`  Round fraction t(r): ${t.toFixed(2)}   Pure interpolation: ${money(interpolated)}`);
  } else {
    console.log(`  Round fraction t(r): ${t.toFixed(2)}   effectiveT (FROZEN momentum gate): ${effectiveT.toFixed(2)}   Pure interpolation (using effectiveT): ${money(interpolated)}`);
  }
  console.log(`  Momentum: everMovedForward=${everMovedForward}   bestPriorCustomerOffer=${bestPriorCustomerOffer !== undefined ? money(bestPriorCustomerOffer) : "(none)"}   minImprovement=${money(minImprovement)}`);
  if (customerPrice !== undefined && customerPrice > 0 && round < maxRounds) {
    const clampedCustomer = Math.max(customerPrice, floor);
    console.log(`  Blend weight toward customer: ${effectiveT.toFixed(2)}   Clamped customer price: ${money(clampedCustomer)}`);
  }
  console.log(`  OFFERED PRICE (v1): ${money(offeredPrice)}${round >= maxRounds && !everMovedForward ? "  [final round, floor NOT earned see momentum above]" : ""}`);
  return { offeredPrice, effectiveT, t, everMovedForward, bestPriorCustomerOffer };
}

function printV1Block(
  visible: number,
  floor: number,
  round: number,
  maxRounds: number,
  customerPrice: number | undefined,
  tolerancePct: number,
  earlyExitMinRound: number,
  previousCustomerPrices: (number | undefined)[],
  minImprovement: number,
) {
  const result = computeAndPrintV1Offer(visible, floor, round, maxRounds, customerPrice, previousCustomerPrices, minImprovement);
  printAcceptDecision(
    result.offeredPrice, round, maxRounds, visible, floor, customerPrice, tolerancePct, earlyExitMinRound,
    result.everMovedForward, result.bestPriorCustomerOffer,
  );
  return result.offeredPrice;
}

function buildV2Inputs(
  sessionId: string,
  round: number,
  visible: number,
  floor: number,
  customerPrice: number | undefined,
  previousOfferedPrices: number[],
  previousCustomerPrices: (number | undefined)[],
): OfferInputs {
  return {
    sessionId,
    skuId: PLAYGROUND_SKU_ID,
    createdAt: PLAYGROUND_CREATED_AT,
    visiblePrice: visible,
    hiddenFloorPrice: floor,
    round,
    customerPrice,
    previousOfferedPrices,
    previousCustomerPrices,
  };
}

function computeAndPrintV2Offer(
  sessionId: string,
  round: number,
  maxRounds: number,
  visible: number,
  floor: number,
  customerPrice: number | undefined,
  previousOfferedPrices: number[],
  previousCustomerPrices: (number | undefined)[],
  sellerConfig: SellerGammaConfig,
  signals: EngineSignals,
  constants: EngineConstants,
): OfferResult {
  const inputs = buildV2Inputs(sessionId, round, visible, floor, customerPrice, previousOfferedPrices, previousCustomerPrices);
  const result = computeOfferV2(inputs, sellerConfig, STAGE_0_CONFIG, signals, maxRounds, constants);

  section(`pricing-engine-v2 (round ${round} of ${maxRounds})`);
  console.log(`  sessionId: ${sessionId}  (same sessionId + inputs -> same output, always)`);
  console.log(`  Visible: ${money(visible)}   Floor: ${money(floor)}   Customer offered: ${customerPrice !== undefined ? money(customerPrice) : "(none)"}`);
  console.log(`  stockPressure: ${signals.stockPressure}   demandScore: ${signals.demandScore}`);
  console.log(`  γ (risk aversion): ${result.gamma.toFixed(4)}   Curve exponent k: ${result.k.toFixed(4)}   R*: ${result.effectiveR}`);
  if (result.effectiveT === result.t) {
    console.log(`  t(r): ${result.t.toFixed(4)}`);
  } else {
    console.log(`  t(r): ${result.t.toFixed(4)}   effectiveT (FROZEN momentum gate): ${result.effectiveT.toFixed(4)}`);
  }
  console.log(`  Momentum: genuineThisRound=${result.genuineMomentumThisRound}   everMovedForward=${result.everMovedForward}`);
  console.log(`  Skewed floor this round: ${money(result.skewedFloor)}`);
  console.log(`  Base offer (before customer blend): ${money(result.baseOffer)}`);
  console.log(
    `  Clamped customer price: ${customerPrice !== undefined ? money(result.clampedCustomerPrice) : "(n/a no customer input this round)"}`,
  );
  console.log(`  Customer-influence weight w(r): ${result.customerInfluenceWeight.toFixed(4)}`);
  console.log(`  Blended (pre-jitter): ${money(result.blendedPreJitter)}`);
  console.log(`  Jitter: ${money(result.jitter)}`);
  console.log(
    `  OFFERED PRICE (v2): ${money(result.offeredPrice)}${result.isFinalRound ? (result.everMovedForward ? "  [FINAL ROUND floor, earned via momentum]" : "  [final round, floor NOT earned see momentum above]") : ""}`,
  );

  const validity = checkOfferValidity(result.offeredPrice, floor, visible);
  if (!validity.valid) {
    console.log(`  ⚠ VALIDATION FAILED: ${validity.errors.join("; ")}`);
  }

  return result;
}

function printV2Block(
  sessionId: string,
  round: number,
  maxRounds: number,
  visible: number,
  floor: number,
  customerPrice: number | undefined,
  previousOfferedPrices: number[],
  previousCustomerPrices: (number | undefined)[],
  sellerConfig: SellerGammaConfig,
  signals: EngineSignals,
  constants: EngineConstants,
  tolerancePct: number,
  earlyExitMinRound: number,
): OfferResult {
  const result = computeAndPrintV2Offer(
    sessionId, round, maxRounds, visible, floor, customerPrice, previousOfferedPrices, previousCustomerPrices, sellerConfig, signals, constants,
  );
  const definedPriorOffers = previousCustomerPrices.filter((p): p is number => p !== undefined);
  const bestPriorCustomerOffer = definedPriorOffers.length ? Math.max(...definedPriorOffers) : undefined;
  printAcceptDecision(
    result.offeredPrice, round, maxRounds, visible, floor, customerPrice, tolerancePct, earlyExitMinRound,
    result.everMovedForward, bestPriorCustomerOffer,
  );
  return result;
}

function runSingleRound(flags: Flags) {
  const visible = num(flags, "visible");
  const floor = num(flags, "floor");
  if (visible === undefined || floor === undefined) {
    throw new Error("--visible and --floor are required");
  }
  const round = num(flags, "round", 1)!;
  const maxRounds = num(flags, "maxRounds", MAX_ROUNDS)!;
  const customerPrice = num(flags, "customerPrice");
  const stock = num(flags, "stock", 0.5)!;
  const demand = num(flags, "demand", 0.5)!;
  const gammaBase = num(flags, "gammaBase", DEFAULT_GAMMA_CONFIG.gammaBase)!;
  const alpha = num(flags, "alpha", DEFAULT_GAMMA_CONFIG.alpha)!;
  const beta = num(flags, "beta", DEFAULT_GAMMA_CONFIG.beta)!;
  const sessionId = str(flags, "sessionId") ?? randomSessionId();
  const engineVersion = (str(flags, "engineVersion", "both") as "v1" | "v2" | "both")!;
  const tolerancePct = num(flags, "tolerancePct", DEFAULT_GAMMA_CONFIG.tolerancePct)!;
  const earlyExitMinRound = num(flags, "earlyExitMinRound", DEFAULT_GAMMA_CONFIG.earlyExitMinRound)!;
  const minImprovementPct = num(flags, "minImprovementPct", DEFAULT_GAMMA_CONFIG.minImprovementPct)!;
  const minImprovementFloorRupees = num(flags, "minImprovementFloorRupees", DEFAULT_ENGINE_CONSTANTS.minImprovementFloorRupees)!;
  const previousCustomerPrices = parsePreviousCustomerPrices(flags);

  const sellerConfig: SellerGammaConfig = { ...DEFAULT_GAMMA_CONFIG, gammaBase, alpha, beta, minImprovementPct };
  const constants: EngineConstants = { ...DEFAULT_ENGINE_CONSTANTS, minImprovementFloorRupees };
  const signals: EngineSignals = { ...NEUTRAL_SIGNALS, stockPressure: stock, demandScore: demand };
  const minImprovement = resolveMinImprovement(visible, floor, sellerConfig, constants);

  console.log(`\nRound ${round} of ${maxRounds}`);

  if (engineVersion === "v1" || engineVersion === "both") {
    printV1Block(visible, floor, round, maxRounds, customerPrice, tolerancePct, earlyExitMinRound, previousCustomerPrices, minImprovement);
  }
  if (engineVersion === "v2" || engineVersion === "both") {
    printV2Block(
      sessionId, round, maxRounds, visible, floor, customerPrice, [], previousCustomerPrices, sellerConfig, signals, constants,
      tolerancePct, earlyExitMinRound,
    );
  }
  console.log("");
}

type CustomerStrategy = { kind: "fixed"; value: number } | { kind: "increment"; step: number; start: number };

function parseCustomerStrategy(spec: string | undefined, floor: number, initialCustomerPrice: number | undefined): CustomerStrategy | null {
  if (!spec) return null;
  const [kind, valueStr] = spec.split(":");
  const value = Number(valueStr);
  if (!Number.isFinite(value)) throw new Error(`--customerStrategy value must be numeric, got: ${spec}`);
  if (kind === "fixed") return { kind: "fixed", value };
  if (kind === "increment") return { kind: "increment", step: value, start: initialCustomerPrice ?? Math.round(floor) };
  throw new Error(`Unknown --customerStrategy kind: ${kind} (expected fixed:N or increment:N)`);
}

function customerPriceForRound(strategy: CustomerStrategy | null, round: number, fallback: number | undefined): number | undefined {
  if (!strategy) return fallback;
  if (strategy.kind === "fixed") return strategy.value;
  return strategy.start + strategy.step * (round - 1);
}

function runAllRounds(flags: Flags) {
  const visible = num(flags, "visible");
  const floor = num(flags, "floor");
  if (visible === undefined || floor === undefined) {
    throw new Error("--visible and --floor are required");
  }
  const maxRounds = num(flags, "maxRounds", MAX_ROUNDS)!;
  const stock = num(flags, "stock", 0.5)!;
  const demand = num(flags, "demand", 0.5)!;
  const gammaBase = num(flags, "gammaBase", DEFAULT_GAMMA_CONFIG.gammaBase)!;
  const alpha = num(flags, "alpha", DEFAULT_GAMMA_CONFIG.alpha)!;
  const beta = num(flags, "beta", DEFAULT_GAMMA_CONFIG.beta)!;
  const sessionId = str(flags, "sessionId") ?? randomSessionId();
  const engineVersion = (str(flags, "engineVersion", "v2") as "v1" | "v2" | "both")!;
  const initialCustomerPrice = num(flags, "customerPrice");
  const strategy = parseCustomerStrategy(str(flags, "customerStrategy"), floor, initialCustomerPrice);
  const tolerancePct = num(flags, "tolerancePct", DEFAULT_GAMMA_CONFIG.tolerancePct)!;
  const earlyExitMinRound = num(flags, "earlyExitMinRound", DEFAULT_GAMMA_CONFIG.earlyExitMinRound)!;
  const minImprovementPct = num(flags, "minImprovementPct", DEFAULT_GAMMA_CONFIG.minImprovementPct)!;
  const minImprovementFloorRupees = num(flags, "minImprovementFloorRupees", DEFAULT_ENGINE_CONSTANTS.minImprovementFloorRupees)!;

  const sellerConfig: SellerGammaConfig = { ...DEFAULT_GAMMA_CONFIG, gammaBase, alpha, beta, minImprovementPct };
  const constants: EngineConstants = { ...DEFAULT_ENGINE_CONSTANTS, minImprovementFloorRupees };
  const signals: EngineSignals = { ...NEUTRAL_SIGNALS, stockPressure: stock, demandScore: demand };
  const minImprovement = resolveMinImprovement(visible, floor, sellerConfig, constants);

  console.log(`\n=== Full negotiation playthrough sessionId: ${sessionId} ===`);

  const previousOfferedPrices: number[] = [];
  const previousCustomerPrices: (number | undefined)[] = [];
  for (let round = 1; round <= maxRounds; round++) {
    const customerPrice = customerPriceForRound(strategy, round, initialCustomerPrice);
    console.log(`\nRound ${round} of ${maxRounds}`);

    let offeredPrice: number | undefined;
    if (engineVersion === "v1" || engineVersion === "both") {
      offeredPrice = printV1Block(
        visible, floor, round, maxRounds, customerPrice, tolerancePct, earlyExitMinRound, [...previousCustomerPrices], minImprovement,
      );
    }
    if (engineVersion === "v2" || engineVersion === "both") {
      const result = printV2Block(
        sessionId,
        round,
        maxRounds,
        visible,
        floor,
        customerPrice,
        [...previousOfferedPrices],
        [...previousCustomerPrices],
        sellerConfig,
        signals,
        constants,
        tolerancePct,
        earlyExitMinRound,
      );
      offeredPrice = result.offeredPrice;
      previousOfferedPrices.unshift(result.offeredPrice);
    } else if (offeredPrice !== undefined) {
      previousOfferedPrices.unshift(offeredPrice);
    }
    if (offeredPrice === undefined) throw new Error("internal: no offer was computed for this round");

    const { everMovedForward } = computeMomentumState([...previousCustomerPrices, customerPrice], (r) => r, minImprovement, maxRounds);
    const definedPriorOffers = previousCustomerPrices.filter((p): p is number => p !== undefined);
    const bestPriorCustomerOffer = definedPriorOffers.length ? Math.max(...definedPriorOffers) : undefined;
    previousCustomerPrices.push(customerPrice);

    const evaluation: NegotiationOutcome = decideAcceptOutcome({
      action: "REJECT",
      customerPrice,
      currentOfferedPrice: offeredPrice,
      visiblePrice: visible,
      floorPrice: floor,
      round,
      maxRounds,
      tolerancePct,
      earlyExitMinRound,
      everMovedForward,
      bestPriorCustomerOffer,
    });
    if (evaluation.outcome === "accept") {
      console.log(
        `\n✓ ACCEPTED at round ${round} via Case ${evaluation.decision.acceptCase} ${evaluation.decision.debugLabel}\n  finalPrice: ${money(evaluation.decision.finalPrice)}`,
      );
      return;
    }
    if (evaluation.outcome === "rejected") {
      console.log(
        `\n✗ REJECTED (terminal) at round ${round} final round, no qualifying counter this round (or no genuine momentum shown see momentum above). nudgeDueAt set, eligible for manual-negotiation fallback.`,
      );
      return;
    }
  }
}

async function runInteractive(flags: Flags) {
  const visible = num(flags, "visible");
  const floor = num(flags, "floor");
  if (visible === undefined || floor === undefined) {
    throw new Error("--visible and --floor are required");
  }
  const maxRounds = num(flags, "maxRounds", MAX_ROUNDS)!;
  const stock = num(flags, "stock", 0.5)!;
  const demand = num(flags, "demand", 0.5)!;
  const gammaBase = num(flags, "gammaBase", DEFAULT_GAMMA_CONFIG.gammaBase)!;
  const alpha = num(flags, "alpha", DEFAULT_GAMMA_CONFIG.alpha)!;
  const beta = num(flags, "beta", DEFAULT_GAMMA_CONFIG.beta)!;
  const tolerancePct = num(flags, "tolerancePct", DEFAULT_GAMMA_CONFIG.tolerancePct)!;
  const earlyExitMinRound = num(flags, "earlyExitMinRound", DEFAULT_GAMMA_CONFIG.earlyExitMinRound)!;
  const minImprovementPct = num(flags, "minImprovementPct", DEFAULT_GAMMA_CONFIG.minImprovementPct)!;
  const minImprovementFloorRupees = num(flags, "minImprovementFloorRupees", DEFAULT_ENGINE_CONSTANTS.minImprovementFloorRupees)!;

  const engineVersionFlag = str(flags, "engineVersion", "v2")!;
  if (engineVersionFlag !== "v1" && engineVersionFlag !== "v2") {
    throw new Error("--interactive requires --engineVersion=v1 or v2 (a human responds to one offer per round, not both at once 'both' isn't supported here)");
  }
  const engineVersion = engineVersionFlag as "v1" | "v2";

  const sellerConfig: SellerGammaConfig = { ...DEFAULT_GAMMA_CONFIG, gammaBase, alpha, beta, minImprovementPct };
  const constants: EngineConstants = { ...DEFAULT_ENGINE_CONSTANTS, minImprovementFloorRupees };
  const signals: EngineSignals = { ...NEUTRAL_SIGNALS, stockPressure: stock, demandScore: demand };
  const minImprovement = resolveMinImprovement(visible, floor, sellerConfig, constants);

  const sessionIdFlag = str(flags, "sessionId");
  const sessionId = sessionIdFlag ?? randomSessionId();
  console.log(sessionIdFlag ? `\nUsing sessionId: ${sessionId}` : `\nNo --sessionId given generated: ${sessionId}`);
  console.log(`=== Interactive negotiation engine: ${engineVersion} visible ${money(visible)}, floor ${money(floor)}, maxRounds ${maxRounds} ===`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  async function ask(promptText: string): Promise<string> {
    process.stdout.write(promptText);
    const { value, done } = await lines.next();
    if (done) return "";
    return value.trim();
  }
  function parsePriceAnswer(answer: string, context: string): number | undefined {
    if (answer === "") return undefined;
    const typed = Number(answer);
    if (!Number.isFinite(typed)) {
      console.log(`  ("${answer}" isn't a valid number treating ${context} as blank)`);
      return undefined;
    }
    return typed;
  }

  try {
    let customerPrice: number | undefined = num(flags, "customerPrice");
    if (customerPrice === undefined) {
      const opening = await ask(
        `\nYour opening offer this is what starts the negotiation, same as startSession's customerPrice ` +
        `(blank = start with no opening quote, only possible if your negotiation schema allows it): ₹`,
      );
      customerPrice = parsePriceAnswer(opening, "the opening offer");
    } else {
      console.log(`\nOpening offer (from --customerPrice): ${money(customerPrice)}`);
    }

    const previousOfferedPrices: number[] = [];
    const history: (number | undefined)[] = [];

    for (let round = 1; round <= maxRounds; round++) {
      console.log(`\nRound ${round} of ${maxRounds}`);

      let offeredPrice: number;
      if (engineVersion === "v1") {
        const result = computeAndPrintV1Offer(visible, floor, round, maxRounds, customerPrice, [...history], minImprovement);
        offeredPrice = result.offeredPrice;
      } else {
        const result = computeAndPrintV2Offer(
          sessionId, round, maxRounds, visible, floor, customerPrice, [...previousOfferedPrices], [...history], sellerConfig, signals, constants,
        );
        offeredPrice = result.offeredPrice;
        previousOfferedPrices.unshift(result.offeredPrice);
      }

      const answer = await ask(`\n  Your offer this round (blank = no counter / bare reject): ₹`);
      const thisRoundCustomerPrice = parsePriceAnswer(answer, "this round");
      const { everMovedForward } = computeMomentumState([...history, customerPrice, thisRoundCustomerPrice], (r) => r, minImprovement, maxRounds);
      const definedPriorOffers = [...history, customerPrice].filter((p): p is number => p !== undefined);
      const bestPriorCustomerOffer = definedPriorOffers.length ? Math.max(...definedPriorOffers) : undefined;

      const evaluation = printAcceptDecision(
        offeredPrice, round, maxRounds, visible, floor, thisRoundCustomerPrice, tolerancePct, earlyExitMinRound,
        everMovedForward, bestPriorCustomerOffer,
      );

      if (evaluation.outcome === "accept") {
        console.log(`\n=== Session ends: ACCEPTED at round ${round}, finalPrice ${money(evaluation.decision.finalPrice)} ===`);
        return;
      }
      if (evaluation.outcome === "rejected") {
        console.log(`\n=== Session ends: REJECTED at round ${round} ===`);
        return;
      }

      history.push(customerPrice); 
      customerPrice = thisRoundCustomerPrice;
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    console.log(`
pricing-engine-playground inspect the negotiation pricing engine without a DB/Redis/API.

Required:
  --visible=1500 --floor=1300

Optional:
  --round=1 --maxRounds=3
  --customerPrice=1450
  --stock=0.5 --demand=0.5          (normalized 0..1, default neutral 0.5/0.5)
  --gammaBase=0.35 --alpha=0.3 --beta=0.3   (Stage 0 defaults if omitted)
  --tolerancePct=0.03 --earlyExitMinRound=2 (accept-decision Case 2 tuning, SellerNegotiationConfig defaults if omitted)
  --minImprovementPct=0.005 --minImprovementFloorRupees=5  (momentum gate threshold, see momentum-gate.ts resolved as max(floorRupees, pct*(V-F)); defaults if omitted)
  --previousCustomerPrices=1460,1480  (single-round mode only: chronological prior customerPrice history, "-" for a round with none, for testing the momentum gate directly e.g. with --round=3)
  --sessionId=test-1                (omit for a fresh random one, printed either way)
  --engineVersion=v1|v2|both        (default: both for single-round, v2 for --allRounds/--interactive; 'both' not supported by --interactive)
  --allRounds                       (simulate the whole negotiation)
  --customerStrategy=fixed:1450     (customer always offers 1450)
  --customerStrategy=increment:20   (customer raises their offer by 20 each round, from --customerPrice or floor)
  --interactive                     (asks for your opening offer first, then type your own counter each round from stdin, live, instead of a fixed --customerStrategy)
`);
    return;
  }

  try {
    if (flags.interactive) {
      await runInteractive(flags);
    } else if (flags.allRounds) {
      runAllRounds(flags);
    } else {
      runSingleRound(flags);
    }
  } catch (err: any) {
    console.error(`\nError: ${err.message}\n`);
    process.exit(1);
  }
}

main();
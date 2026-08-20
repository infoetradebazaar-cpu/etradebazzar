import { db } from "../../db/index";
import { resolveTierPrice } from "../../utils/tier-pricing";
import { createOrderFromNegotiation, DeliveryAddress } from "./negotiation-order.helper";
import { NEGOTIATION_SESSION_OMIT } from "./negotiation.select";
import { computeOfferV2 } from "./pricing-engine-v2/engine";
import { resolveEngineConfig, resolveEngineConstants, resolveSellerGammaConfig } from "./pricing-engine-v2/config-resolution";
import { resolveEngineSignals } from "./pricing-engine-v2/signal-cache";
import { assignFormulaVersion, getRolloutPercent, type FormulaVersion } from "./pricing-engine-v2/ab-bucketing";
import { MAX_ROUNDS, interpolateOffer } from "./legacy-linear-formula";
import { decideAcceptOutcome, type AcceptCase, type AcceptDecision, type NegotiationOutcome } from "./accept-decision";
import { computeMomentumState } from "./momentum-gate";
import { canAccessOrgResource } from "../../lib/permission/customer-org-permission.service";
import { CUSTOMER_ORG_PERMISSIONS } from "../../lib/permission/customer-org-permission.constants";
import { setCustomerOrgScope } from "../../middleware/tenant";

export { MAX_ROUNDS, interpolateOffer, decideAcceptOutcome };
export type { AcceptCase, AcceptDecision, NegotiationOutcome };

interface SessionForOffer {
  id: string;
  skuId: string;
  productId: string;
  sellerId: string;
  customerId: string;
  quantity: number;
  createdAt: Date;
}

async function resolveFormulaAssignment(session: { id: string; skuId: string; createdAt: Date }) {
  const [rolloutPercent, engineConfig] = await Promise.all([getRolloutPercent(), resolveEngineConfig()]);
  const formulaVersion = assignFormulaVersion(session.id, session.skuId, session.createdAt, rolloutPercent);
  return { formulaVersion, activeEngineFlags: engineConfig };
}

async function resolveAcceptConfig(
  sellerId: string,
  productId: string,
  visiblePrice: number,
  floorPrice: number,
): Promise<{ tolerancePct: number; earlyExitMinRound: number; minImprovement: number }> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { categoryId: true } });
  const categoryId = product?.categoryId ?? "";
  const [config, constants] = await Promise.all([resolveSellerGammaConfig(sellerId, categoryId), resolveEngineConstants()]);
  const minImprovement = Math.max(constants.minImprovementFloorRupees, config.minImprovementPct * (visiblePrice - floorPrice));
  return { tolerancePct: config.tolerancePct, earlyExitMinRound: config.earlyExitMinRound, minImprovement };
}

async function computeOffer(
  formulaVersion: FormulaVersion,
  session: SessionForOffer,
  visiblePrice: number,
  hiddenFloor: number,
  round: number,
  customerPrice: number | undefined,
  previousOfferedPrices: number[],
  previousCustomerPrices: (number | undefined)[],
): Promise<number> {
  const product = await db.product.findUnique({ where: { id: session.productId }, select: { categoryId: true } });
  const categoryId = product?.categoryId ?? "";
  const [sellerConfig, constants] = await Promise.all([
    resolveSellerGammaConfig(session.sellerId, categoryId),
    resolveEngineConstants(),
  ]);

  if (formulaVersion === "v1_linear") {
    const minImprovement = Math.max(constants.minImprovementFloorRupees, sellerConfig.minImprovementPct * (visiblePrice - hiddenFloor));
    return interpolateOffer(visiblePrice, hiddenFloor, round, customerPrice, previousCustomerPrices, minImprovement);
  }

  const engineConfig = await resolveEngineConfig();
  const signals = await resolveEngineSignals({
    skuId: session.skuId,
    categoryId,
    customerId: session.customerId,
    quantity: session.quantity,
    engineConfig,
  });

  const result = computeOfferV2(
    {
      sessionId: session.id,
      skuId: session.skuId,
      createdAt: session.createdAt,
      visiblePrice,
      hiddenFloorPrice: hiddenFloor,
      round,
      customerPrice,
      previousOfferedPrices,
      previousCustomerPrices,
    },
    sellerConfig,
    engineConfig,
    signals,
    MAX_ROUNDS,
    constants,
  );
  return result.offeredPrice;
}
async function customerMayActOnSession(
  customerId: string,
  session: { customerId: string; orgId: string | null },
): Promise<boolean> {
  if (session.customerId === customerId) return true;
  return canAccessOrgResource(customerId, session.orgId, CUSTOMER_ORG_PERMISSIONS.MANAGE_NEGOTIATIONS);
}

export const autoNegotiationService = {
  async startSession(
    customerId: string,
    sellerId: string,
    productId: string,
    skuId: string,
    quantity: number,
    customerPrice?: number,
    orgId?: string | null,
  ) {
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");

    const resolution = await resolveTierPrice(skuId, quantity);
    if (resolution.zone === "beyond" || resolution.zone === "gap") {
      throw new Error("Quantity is beyond auto-negotiable tiers use manual negotiation instead");
    }
    if (resolution.hiddenFloorPrice === null) {
      throw new Error("Auto-negotiation is not available for this quantity use manual negotiation instead");
    }

    const openSession = await db.negotiationSession.findFirst({
      where: {
        skuId,
        status: { in: ["PENDING", "EXHAUSTED"] },
        ...(orgId ? { OR: [{ orgId }, { customerId }] } : { customerId }),
      },
    });
    if (openSession) {
      throw new Error("A negotiation session is already open for this product respond to it instead");
    }

    try {
      return await db.$transaction(async (tx) => {
        await setCustomerOrgScope(tx, orgId);
        const session = await tx.negotiationSession.create({
          data: {
            customerId,
            orgId: orgId ?? null,
            sellerId,
            productId,
            skuId,
            quantity,
            mode: "AUTO",
            visibleTierPrice: resolution.visiblePrice,
            hiddenFloorPrice: resolution.hiddenFloorPrice,
            round: 1,
          },
          omit: NEGOTIATION_SESSION_OMIT,
        });

        const { formulaVersion, activeEngineFlags } = await resolveFormulaAssignment(session);
        const offeredPrice = await computeOffer(
          formulaVersion,
          { id: session.id, skuId, productId, sellerId, customerId, quantity, createdAt: session.createdAt },
          resolution.visiblePrice,
          resolution.hiddenFloorPrice!,
          1,
          customerPrice,
          [],
          [],
        );

        const updated = await tx.negotiationSession.update({
          where: { id: session.id },
          data: { formulaVersion, activeEngineFlags: activeEngineFlags as any },
          omit: NEGOTIATION_SESSION_OMIT,
        });

        await tx.negotiationRound.create({
          data: { sessionId: session.id, round: 1, offeredPrice, customerPrice },
        });

        return { session: updated, offeredPrice };
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new Error("A negotiation session is already open for this product respond to it instead");
      }
      throw err;
    }
  },

  async getSession(customerId: string, sessionId: string) {
    const session = await db.negotiationSession.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { round: "asc" } } },
      omit: NEGOTIATION_SESSION_OMIT,
    });
    if (!session) throw new Error("Negotiation session not found");
    if (!(await customerMayActOnSession(customerId, session))) {
      throw new Error("Negotiation session not found");
    }
    return session;
  },

  async respond(
    customerId: string,
    sessionId: string,
    action: "ACCEPT" | "REJECT",
    deliveryAddress?: DeliveryAddress,
    customerPrice?: number,
  ) {
    const session = await db.negotiationSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error("Negotiation session not found");
    if (!(await customerMayActOnSession(customerId, session))) {
      throw new Error("Negotiation session not found");
    }
    if (session.mode !== "AUTO") throw new Error("This session is not an auto-negotiation");
    if (session.status !== "PENDING" && session.status !== "EXHAUSTED") {
      throw new Error("This negotiation is already resolved");
    }

    const currentRound = await db.negotiationRound.findUnique({
      where: { sessionId_round: { sessionId, round: session.round } },
    });
    if (!currentRound) throw new Error("Negotiation round not found");

    const currentOfferedPrice = Number(currentRound.offeredPrice);
    const visiblePrice = Number(session.visibleTierPrice);
    const floorPrice = Number(session.hiddenFloorPrice);

    const { tolerancePct, earlyExitMinRound, minImprovement } = await resolveAcceptConfig(
      session.sellerId,
      session.productId,
      visiblePrice,
      floorPrice,
    );

    const priorRounds = await db.negotiationRound.findMany({
      where: { sessionId },
      orderBy: { round: "asc" },
      select: { offeredPrice: true, customerPrice: true },
    });
    const previousCustomerPrices = priorRounds.map((r) => (r.customerPrice !== null ? Number(r.customerPrice) : undefined));
    const previousOfferedPrices = [...priorRounds].reverse().map((r) => Number(r.offeredPrice)); // most-recent-first, existing convention (priceImpact)

    const { everMovedForward } = computeMomentumState([...previousCustomerPrices, customerPrice], (k) => k, minImprovement, MAX_ROUNDS);
    const definedPriorOffers = previousCustomerPrices.filter((p): p is number => p !== undefined);
    const bestPriorCustomerOffer = definedPriorOffers.length ? Math.max(...definedPriorOffers) : undefined;

    const evaluation: NegotiationOutcome =
      action === "ACCEPT"
        ? { outcome: "continue" }
        : decideAcceptOutcome({
            action,
            customerPrice,
            currentOfferedPrice,
            visiblePrice,
            floorPrice,
            round: session.round,
            maxRounds: MAX_ROUNDS,
            tolerancePct,
            earlyExitMinRound,
            everMovedForward,
            bestPriorCustomerOffer,
          });

    const isAccept = action === "ACCEPT" || evaluation.outcome === "accept";
    const isTerminalReject = action === "REJECT" && evaluation.outcome === "rejected";
    const finalPriceIfAccept =
      action === "ACCEPT" ? Math.round(currentOfferedPrice) : evaluation.outcome === "accept" ? evaluation.decision.finalPrice : undefined;

    if (isAccept && !deliveryAddress) {
      throw new Error(
        evaluation.outcome === "accept"
          ? `Your offer meets our price of ${finalPriceIfAccept} provide a delivery address to accept it`
          : "Delivery address is required to accept and place the order",
      );
    }

    const result = await db.$transaction(async (tx) => {
      await setCustomerOrgScope(tx, session.orgId);
      const claimed = await tx.negotiationRound.updateMany({
        where: { id: currentRound.id, response: null },
        data: { response: isAccept ? "ACCEPT" : action, respondedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new Error("This round has already been responded to");
      }

      if (isAccept) {
        const finalPrice = finalPriceIfAccept!;
        const order = await createOrderFromNegotiation(tx, session, finalPrice, deliveryAddress!);
        await tx.negotiationSession.update({
          where: { id: sessionId },
          data: { status: "ACCEPTED", finalPrice, orderId: order.id },
        });
        return {
          status: "ACCEPTED" as const,
          order,
          acceptCase: evaluation.outcome === "accept" ? evaluation.decision.acceptCase : undefined,
        };
      }

      if (isTerminalReject) {
        await tx.negotiationSession.update({
          where: { id: sessionId },
          data: {
            status: "REJECTED",
            nudgeDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        return { status: "REJECTED" as const };
      }

      const nextRound = session.round + 1;

      const offeredPrice = await computeOffer(
        session.formulaVersion as FormulaVersion,
        {
          id: session.id,
          skuId: session.skuId,
          productId: session.productId,
          sellerId: session.sellerId,
          customerId: session.customerId,
          quantity: session.quantity,
          createdAt: session.createdAt,
        },
        Number(session.visibleTierPrice),
        Number(session.hiddenFloorPrice),
        nextRound,
        customerPrice,
        previousOfferedPrices,
        previousCustomerPrices,
      );
      await tx.negotiationRound.create({
        data: { sessionId, round: nextRound, offeredPrice, customerPrice },
      });
      const newStatus = nextRound >= MAX_ROUNDS ? "EXHAUSTED" : "PENDING";
      await tx.negotiationSession.update({
        where: { id: sessionId },
        data: { round: nextRound, status: newStatus },
      });
      return { status: newStatus, offeredPrice };
    });

    return result;
  },
};

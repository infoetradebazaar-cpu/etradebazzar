import { db } from "../../db/index";
import { resolveTierPrice } from "../../utils/tier-pricing";
import { createOrderFromNegotiation, DeliveryAddress } from "./negotiation-order.helper";
import { NEGOTIATION_SESSION_OMIT } from "./negotiation.select";

export const MAX_ROUNDS = 3;

function interpolateOffer(visiblePrice: number, hiddenFloor: number, round: number): number {
  if (round >= MAX_ROUNDS) return hiddenFloor;
  const fraction = round / MAX_ROUNDS;
  const raw = visiblePrice - (visiblePrice - hiddenFloor) * fraction;
  return Math.round(raw * 100) / 100;
}

export const autoNegotiationService = {
  async startSession(customerId: string, sellerId: string, productId: string, skuId: string, quantity: number) {
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");

    const resolution = await resolveTierPrice(skuId, quantity);
    if (resolution.zone === "beyond") {
      throw new Error("Quantity is beyond auto-negotiable tiers use manual negotiation instead");
    }
    if (resolution.hiddenFloorPrice === null) {
      throw new Error("Auto-negotiation is not available for this quantity use manual negotiation instead");
    }

    const openSession = await db.negotiationSession.findFirst({
      where: { customerId, skuId, status: { in: ["PENDING", "EXHAUSTED"] } },
    });
    if (openSession) {
      throw new Error("A negotiation session is already open for this product respond to it instead");
    }

    try {
      return await db.$transaction(async (tx) => {
        const session = await tx.negotiationSession.create({
          data: {
            customerId,
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

        const offeredPrice = interpolateOffer(resolution.visiblePrice, resolution.hiddenFloorPrice!, 1);
        await tx.negotiationRound.create({
          data: { sessionId: session.id, round: 1, offeredPrice },
        });

        return { session, offeredPrice };
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new Error("A negotiation session is already open for this product respond to it instead");
      }
      throw err;
    }
  },

  async getSession(customerId: string, sessionId: string) {
    const session = await db.negotiationSession.findFirst({
      where: { id: sessionId, customerId },
      include: { rounds: { orderBy: { round: "asc" } } },
      omit: NEGOTIATION_SESSION_OMIT,
    });
    if (!session) throw new Error("Negotiation session not found");
    return session;
  },

  async respond(
    customerId: string,
    sessionId: string,
    action: "ACCEPT" | "REJECT",
    deliveryAddress?: DeliveryAddress,
  ) {
    const session = await db.negotiationSession.findFirst({ where: { id: sessionId, customerId } });
    if (!session) throw new Error("Negotiation session not found");
    if (session.mode !== "AUTO") throw new Error("This session is not an auto-negotiation");
    if (session.status !== "PENDING" && session.status !== "EXHAUSTED") {
      throw new Error("This negotiation is already resolved");
    }

    const currentRound = await db.negotiationRound.findUnique({
      where: { sessionId_round: { sessionId, round: session.round } },
    });
    if (!currentRound) throw new Error("Negotiation round not found");

    if (action === "ACCEPT" && !deliveryAddress) {
      throw new Error("Delivery address is required to accept and place the order");
    }

    const result = await db.$transaction(async (tx) => {
      const claimed = await tx.negotiationRound.updateMany({
        where: { id: currentRound.id, response: null },
        data: { response: action, respondedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new Error("This round has already been responded to");
      }

      if (action === "ACCEPT") {
        const finalPrice = Number(currentRound.offeredPrice);
        const order = await createOrderFromNegotiation(tx, session, finalPrice, deliveryAddress!);
        await tx.negotiationSession.update({
          where: { id: sessionId },
          data: { status: "ACCEPTED", finalPrice, orderId: order.id },
        });
        return { status: "ACCEPTED" as const, order };
      }

      // REJECT
      if (session.status === "EXHAUSTED") {
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
      const offeredPrice = interpolateOffer(
        Number(session.visibleTierPrice),
        Number(session.hiddenFloorPrice),
        nextRound,
      );
      await tx.negotiationRound.create({ data: { sessionId, round: nextRound, offeredPrice } });
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

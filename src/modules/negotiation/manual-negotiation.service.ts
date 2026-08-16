import { db } from "../../db/index";
import { resolveTierPrice } from "../../utils/tier-pricing";
import { createOrderFromNegotiation, DeliveryAddress } from "./negotiation-order.helper";
import { NEGOTIATION_SESSION_OMIT } from "./negotiation.select";
import { notificationService } from "../notification/notification.service";
import { logger } from "../../utils/logger";

type ActorType = "customer" | "seller";

async function notifySellerOfNewSession(sellerId: string, productId: string, quantity: number, sessionId: string) {
  try {
    const [owner, product] = await Promise.all([
      db.sellerMember.findFirst({
        where: { sellerId, role: { name: "owner" }, isActive: true },
        select: { userId: true, user: { select: { email: true, name: true } } },
      }),
      db.product.findUnique({ where: { id: productId }, select: { name: true } }),
    ]);
    if (!owner) return;
    await notificationService.manualNegotiationStarted({
      userId: owner.userId,
      email: owner.user.email,
      sellerName: owner.user.name ?? "there",
      productName: product?.name ?? "your product",
      quantity,
      sessionId,
    });
  } catch (err: any) {
    logger.error({ err: err.message, sellerId, sessionId }, "Failed to notify seller of new manual negotiation");
  }
}

async function loadSessionForActor(sessionId: string, actorId: string, actorType: ActorType) {
  const session = await db.negotiationSession.findFirst({
    where:
      actorType === "customer"
        ? { id: sessionId, customerId: actorId }
        : { id: sessionId, sellerId: actorId },
    omit: NEGOTIATION_SESSION_OMIT,
  });
  if (!session) throw new Error("Negotiation session not found");
  if (session.mode !== "MANUAL") throw new Error("This session is not a manual negotiation");
  return session;
}

export const manualNegotiationService = {
  async startSession(customerId: string, sellerId: string, productId: string, skuId: string, quantity: number) {
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");

    const resolution = await resolveTierPrice(skuId, quantity);
    if (resolution.zone !== "beyond" && resolution.hiddenFloorPrice !== null) {
      // Check if there's a rejected auto-negotiation session for this customer+sku
      const rejectedAuto = await db.negotiationSession.findFirst({
        where: { customerId, skuId, mode: "AUTO", status: "REJECTED" },
      });
      if (!rejectedAuto) {
        throw new Error("This quantity is eligible for auto-negotiation use the auto-negotiation flow instead");
      }
    }

    const openSession = await db.negotiationSession.findFirst({
      where: { customerId, skuId, status: "PENDING" },
    });
    if (openSession) {
      throw new Error("A negotiation session is already open for this product use it instead");
    }

    let session;
    try {
      session = await db.negotiationSession.create({
        data: {
          customerId,
          sellerId,
          productId,
          skuId,
          quantity,
          mode: "MANUAL",
          visibleTierPrice: resolution.visiblePrice,
          hiddenFloorPrice: null,
          chat: { create: {} },
        },
        include: { chat: true },
        omit: NEGOTIATION_SESSION_OMIT,
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new Error("A negotiation session is already open for this product use it instead");
      }
      throw err;
    }

    await notifySellerOfNewSession(sellerId, productId, quantity, session.id);
    return session;
  },

  async getSession(actorId: string, actorType: ActorType, sessionId: string) {
    const session = await loadSessionForActor(sessionId, actorId, actorType);
    const chat = await db.negotiationChatSession.findUnique({
      where: { sessionId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    // For seller view, include customer info
    const customer = actorType === "seller"
      ? await db.user.findUnique({
          where: { id: session.customerId },
          select: { id: true, name: true, email: true },
        })
      : null;
    return { session, chat, customer };
  },

  async sendMessage(actorId: string, actorType: ActorType, sessionId: string, body: string) {
    const session = await loadSessionForActor(sessionId, actorId, actorType);
    if (session.status !== "PENDING") throw new Error("This negotiation is already resolved");

    const chat = await db.negotiationChatSession.findUnique({ where: { sessionId } });
    if (!chat) throw new Error("Chat session not found");

    return db.negotiationMessage.create({
      data: { chatSessionId: chat.id, senderId: actorId, senderType: actorType, body },
    });
  },

  async proposeTimeSlot(actorId: string, actorType: ActorType, sessionId: string, timeSlot: Date) {
    const session = await loadSessionForActor(sessionId, actorId, actorType);
    if (session.status !== "PENDING") throw new Error("This negotiation is already resolved");

    const chat = await db.negotiationChatSession.findUnique({ where: { sessionId } });
    if (!chat) throw new Error("Chat session not found");

    return db.negotiationChatSession.update({
      where: { sessionId },
      data: {
        proposedTimeSlot: timeSlot,
        proposedBy: actorType,
        customerConfirmed: actorType === "customer",
        sellerConfirmed: actorType === "seller",
        confirmedAt: null,
      },
    });
  },

  async confirmTimeSlot(actorId: string, actorType: ActorType, sessionId: string) {
    const session = await loadSessionForActor(sessionId, actorId, actorType);
    if (session.status !== "PENDING") throw new Error("This negotiation is already resolved");

    const chat = await db.negotiationChatSession.findUnique({ where: { sessionId } });
    if (!chat) throw new Error("Chat session not found");
    if (!chat.proposedTimeSlot) throw new Error("No time slot has been proposed yet");
    if (chat.proposedBy === actorType) {
      throw new Error("Waiting on the other party to confirm - you already proposed this slot");
    }

    return db.$transaction(async (tx) => {
      const updated = await tx.negotiationChatSession.update({
        where: { sessionId },
        data: {
          customerConfirmed: actorType === "customer" ? true : chat.customerConfirmed,
          sellerConfirmed: actorType === "seller" ? true : chat.sellerConfirmed,
        },
      });
      if (updated.customerConfirmed && updated.sellerConfirmed && !updated.confirmedAt) {
        return tx.negotiationChatSession.update({
          where: { sessionId },
          data: { confirmedAt: new Date() },
        });
      }
      return updated;
    });
  },

  async accept(customerId: string, sessionId: string, finalPrice: number, deliveryAddress: DeliveryAddress) {
    const session = await db.negotiationSession.findFirst({ where: { id: sessionId, customerId } });
    if (!session) throw new Error("Negotiation session not found");
    if (session.mode !== "MANUAL") throw new Error("This session is not a manual negotiation");
    if (session.status !== "PENDING") throw new Error("This negotiation is already resolved");

    return db.$transaction(async (tx) => {
      const claimed = await tx.negotiationSession.updateMany({
        where: { id: sessionId, status: "PENDING" },
        data: { status: "ACCEPTED", finalPrice },
      });
      if (claimed.count === 0) throw new Error("This negotiation is already resolved");

      const order = await createOrderFromNegotiation(tx, session, finalPrice, deliveryAddress);
      await tx.negotiationSession.update({ where: { id: sessionId }, data: { orderId: order.id } });
      return { status: "ACCEPTED" as const, order };
    });
  },

  async reject(actorId: string, actorType: ActorType, sessionId: string) {
    const session = await loadSessionForActor(sessionId, actorId, actorType);
    if (session.status !== "PENDING") throw new Error("This negotiation is already resolved");

    const updated = await db.negotiationSession.updateMany({
      where: { id: sessionId, status: "PENDING" },
      data: { status: "REJECTED" },
    });
    if (updated.count === 0) throw new Error("This negotiation is already resolved");
    return { status: "REJECTED" as const };
  },
};

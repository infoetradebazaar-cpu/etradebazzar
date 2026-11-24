import { db } from "../../db/index";
import { resolveTierPrice } from "../../utils/tier-pricing";
import { createOrderFromNegotiation, DeliveryAddress } from "./negotiation-order.helper";
import { NEGOTIATION_SESSION_OMIT } from "./negotiation.select";
import { notificationService } from "../notification/notification.service";
import { chargeNegotiationFee, getNegotiationQuota, type NegotiationIntent } from "./negotiation-gate";
import { invoicingService } from "../invoicing/invoicing.service";
import { getCommissionRate } from "../../utils/commission";
import { logger } from "../../utils/logger";
import { canAccessOrgResource } from "../../lib/permission/customer-org-permission.service";
import { CUSTOMER_ORG_PERMISSIONS } from "../../lib/permission/customer-org-permission.constants";
import { setCustomerOrgScope, withCustomerOrgScope } from "../../middleware/tenant";
import type { Prisma } from "../../../prisma/generated/client";

type ActorType = "customer" | "seller";

type RejectedAutoSession = {
  id: string;
  quantity: number;
  visibleTierPrice: unknown;
  rounds: { round: number; offeredPrice: unknown; customerPrice: unknown }[];
};

function buildResumeSummaryMessage(autoSession: RejectedAutoSession): string {
  const offers = autoSession.rounds
    .map((r) => (r.customerPrice !== null ? `₹${Number(r.customerPrice).toLocaleString("en-IN")}` : "no counter"))
    .join("  ");
  return (
    `This customer previously tried automatic negotiation for this item (qty: ${autoSession.quantity}). ` +
    `Their offers across rounds: ${offers || "(none)"}. ` +
    `Automatic negotiation ended without a deal.`
  );
}

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

function runInOrgScope<T>(
  orgId: string | null | undefined,
  fn: (client: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return orgId ? withCustomerOrgScope(orgId, fn) : fn(db);
}

async function loadSessionForActor(sessionId: string, actorId: string, actorType: ActorType) {
  const session = await db.negotiationSession.findUnique({
    where: { id: sessionId },
    omit: NEGOTIATION_SESSION_OMIT,
  });
  if (!session) throw new Error("Negotiation session not found");

  const permitted =
    actorType === "customer"
      ? session.customerId === actorId ||
        (await canAccessOrgResource(
          actorId,
          session.orgId,
          CUSTOMER_ORG_PERMISSIONS.MANAGE_NEGOTIATIONS,
        ))
      : session.sellerId === actorId;
  if (!permitted) throw new Error("Negotiation session not found");

  if (session.mode !== "MANUAL") throw new Error("This session is not a manual negotiation");
  return session;
}

export const manualNegotiationService = {
  async startSession(customerId: string, sellerId: string, productId: string, skuId: string, quantity: number, orgId?: string | null, intent?: NegotiationIntent, requireIntent = false) {
    const sku = await db.productSKU.findFirst({ where: { id: skuId, productId } });
    if (!sku) throw new Error("SKU not found");

    const scope = orgId ? { OR: [{ orgId }, { customerId }] } : { customerId };

    const rejectedAuto = await db.negotiationSession.findFirst({
      where: { ...scope, skuId, mode: "AUTO", status: "REJECTED" },
      orderBy: { createdAt: "desc" },
      include: { rounds: { orderBy: { round: "asc" } } },
    });

    const effectiveIntent = intent ?? (rejectedAuto?.intent as NegotiationIntent | null | undefined) ?? undefined;
    if (!effectiveIntent && requireIntent) {
      throw new Error("Requirements form must be filled before negotiating");
    }

    let visiblePrice: number;
    if (rejectedAuto && rejectedAuto.quantity === quantity) {
      visiblePrice = Number(rejectedAuto.visibleTierPrice);
      resolveTierPrice(skuId, quantity)
        .then((fresh) => {
          if (Math.abs(fresh.visiblePrice - visiblePrice) > 0.01) {
            logger.warn(
              { skuId, quantity, resumedSessionId: rejectedAuto.id, staleVisiblePrice: visiblePrice, freshVisiblePrice: fresh.visiblePrice },
              "Tier price changed since the AUTO session being resumed was created MANUAL session was created with the stale (AUTO session's) price",
            );
          }
        })
        .catch(() => null);
    } else {
      const resolution = await resolveTierPrice(skuId, quantity);
      if (
        resolution.zone !== "beyond" &&
        resolution.zone !== "gap" &&
        resolution.hiddenFloorPrice !== null &&
        !rejectedAuto
      ) {
        throw new Error("This quantity is eligible for auto-negotiation use the auto-negotiation flow instead");
      }
      visiblePrice = resolution.visiblePrice;
    }

    const openSession = await db.negotiationSession.findFirst({
      where: { ...scope, skuId, status: "PENDING" },
    });
    if (openSession) {
      throw new Error("A negotiation session is already open for this product use it instead");
    }

    const quota = await getNegotiationQuota(customerId, orgId);
    let session;
    try {
      session = await runInOrgScope(orgId, (client) => client.negotiationSession.create({
        data: {
          customerId,
          orgId: orgId ?? null,
          sellerId,
          productId,
          skuId,
          quantity,
          mode: "MANUAL",
          visibleTierPrice: visiblePrice,
          hiddenFloorPrice: null,
          resumedFromSessionId: rejectedAuto?.id ?? null,
          intent: (effectiveIntent ?? undefined) as any,
          chat: {
            create: rejectedAuto
              ? { messages: { create: { senderId: "system", senderType: "system", body: buildResumeSummaryMessage(rejectedAuto) } } }
              : {},
          },
        },
        include: { chat: { include: { messages: true } } },
        omit: NEGOTIATION_SESSION_OMIT,
      }));
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new Error("A negotiation session is already open for this product use it instead");
      }
      throw err;
    }

    try {
      session.creditsCharged = await chargeNegotiationFee(customerId, session.id, quota.feeCredits);
    } catch (err) {
      await db.negotiationSession.delete({ where: { id: session.id } }).catch(() => null);
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
    const resumedFrom = session.resumedFromSessionId
      ? await db.negotiationSession.findUnique({
          where: { id: session.resumedFromSessionId },
          select: {
            id: true,
            quantity: true,
            visibleTierPrice: true,
            status: true,
            createdAt: true,
            rounds: { select: { round: true, offeredPrice: true, customerPrice: true, response: true }, orderBy: { round: "asc" } },
          },
        })
      : null;
    const platformFeePercent = await manualNegotiationService.getPlatformFeePercent(session.productId);
    return { session, chat, customer, resumedFrom, platformFeePercent };
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

  async getPlatformFeePercent(productId: string): Promise<number> {
    const product = await db.product.findUnique({ where: { id: productId }, select: { category: { select: { name: true } } } });
    return getCommissionRate(productId, product?.category?.name ?? "");
  },

  async sendOffer(
    actorId: string,
    actorType: ActorType,
    sessionId: string,
    input: { unitPrice: number; quantity: number; deliveryDays?: number; note?: string },
  ) {
    const session = await loadSessionForActor(sessionId, actorId, actorType);
    if (session.status !== "PENDING") throw new Error("This negotiation is already resolved");

    const chat = await db.negotiationChatSession.findUnique({ where: { sessionId } });
    if (!chat) throw new Error("Chat session not found");

    const feePercent = await manualNegotiationService.getPlatformFeePercent(session.productId);
    const total = parseFloat((input.unitPrice * input.quantity).toFixed(2));
    const platformFee = parseFloat(((total * feePercent) / 100).toFixed(2));
    const offer = {
      unitPrice: input.unitPrice,
      quantity: input.quantity,
      deliveryDays: input.deliveryDays ?? null,
      note: input.note ?? null,
      total,
      platformFeePercent: feePercent,
      platformFee,
      sellerReceives: parseFloat((total - platformFee).toFixed(2)),
    };
    const who = actorType === "seller" ? "Seller" : "Buyer";
    const body =
      `${who} offer: Rs. ${input.unitPrice} x ${input.quantity} = Rs. ${total}` +
      (input.deliveryDays ? `, delivery in ${input.deliveryDays} days` : "") +
      (input.note ? `. ${input.note}` : "");

    return db.negotiationMessage.create({
      data: { chatSessionId: chat.id, senderId: actorId, senderType: actorType, body, kind: "OFFER", offer },
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
    const session = await db.negotiationSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error("Negotiation session not found");
    const permitted =
      session.customerId === customerId ||
      (await canAccessOrgResource(
        customerId,
        session.orgId,
        CUSTOMER_ORG_PERMISSIONS.MANAGE_NEGOTIATIONS,
      ));
    if (!permitted) throw new Error("Negotiation session not found");
    if (session.mode !== "MANUAL") throw new Error("This session is not a manual negotiation");
    if (session.status !== "PENDING") throw new Error("This negotiation is already resolved");

    const result = await db.$transaction(async (tx) => {
      await setCustomerOrgScope(tx, session.orgId);
      const claimed = await tx.negotiationSession.updateMany({
        where: { id: sessionId, status: "PENDING" },
        data: { status: "ACCEPTED", finalPrice },
      });
      if (claimed.count === 0) throw new Error("This negotiation is already resolved");

      const order = await createOrderFromNegotiation(tx, session, finalPrice, deliveryAddress);
      await tx.negotiationSession.update({ where: { id: sessionId }, data: { orderId: order.id } });
      return { status: "ACCEPTED" as const, order };
    });

    if (result.status === "ACCEPTED" && "order" in result) {
      invoicingService
        .generateQuotation(result.order.id, { userId: "system", sellerId: session.sellerId, actorType: "system" })
        .catch((err: any) => logger.error({ err: err.message, orderId: result.order.id }, "Quotation on acceptance failed"));
      notificationService
        .sellerNewOrder({
          sellerId: session.sellerId,
          orderId: result.order.id,
          displayId: result.order.displayId,
          totalAmount: Number(result.order.finalAmount ?? result.order.totalAmount),
        })
        .catch(() => null);
    }
    return result;
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

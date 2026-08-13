import { db } from "../../db/index";
import { syncProductSearchIndexInBackground } from "../../lib/search/product-search-document";

const MAX_ROUNDS = 6;

type ActorType = "seller" | "platform";

function assertActorAllowed(
  product: { sellerId: string },
  actorType: ActorType,
  sellerId: string | undefined,
): void {
  if (actorType === "platform") return; // route-level requirePlatformAdminAndPermission already gated this
  if (actorType === "seller" && sellerId && product.sellerId === sellerId) return;
  throw new Error("Product not found");
}

export const commissionNegotiationService = {
  async proposeCommission(
    productId: string,
    actorId: string,
    actorType: ActorType,
    sellerId: string | undefined,
    data: { rate: number; note?: string },
  ) {
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) throw new Error("Product not found");
    assertActorAllowed(product, actorType, sellerId);

    if (product.status !== "APPROVED" && product.status !== "LIVE") {
      throw new Error("Product must be APPROVED or LIVE to propose a commission rate");
    }

    const openProposal = await db.commissionProposal.findFirst({
      where: { productId, status: { in: ["PENDING", "COUNTERED"] } },
    });
    if (openProposal) {
      throw new Error("A commission proposal is already open for this product respond to it instead");
    }

    return db.$transaction(async (tx) => {
      const proposal = await tx.commissionProposal.create({
        data: {
          productId,
          proposedRate: data.rate,
          proposedBy: actorId,
          proposedByType: actorType,
          note: data.note,
          round: 1,
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId: product.sellerId,
          actorId,
          actorType,
          action: "COMMISSION_PROPOSED",
          entityType: "commission_proposal",
          entityId: proposal.id,
          metadata: { productId, rate: data.rate, round: 1 },
        },
      });

      return proposal;
    });
  },

  async respondToCommissionProposal(
    productId: string,
    proposalId: string,
    actorId: string,
    actorType: ActorType,
    sellerId: string | undefined,
    data: { action: "ACCEPT" | "REJECT" | "COUNTER"; counterRate?: number; note?: string },
  ) {
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) throw new Error("Product not found");
    assertActorAllowed(product, actorType, sellerId);

    const current = await db.commissionProposal.findUnique({ where: { id: proposalId } });
    if (!current || current.productId !== productId) throw new Error("Commission proposal not found");

    // The other party must respond, not the one who just proposed/countered.
    if (current.proposedByType === actorType) {
      throw new Error("Waiting on the other party to respond to this proposal");
    }

    if (data.action === "COUNTER" && current.round >= MAX_ROUNDS) {
      throw new Error(
        `Commission negotiation has reached its ${MAX_ROUNDS}-round limit - accept, reject, or escalate outside this flow`,
      );
    }

    const newStatus = data.action === "ACCEPT" ? "ACCEPTED" : data.action === "REJECT" ? "REJECTED" : "COUNTERED";
    let flippedToLive = false;

    const result = await db.$transaction(async (tx) => {
      const updateResult = await tx.commissionProposal.updateMany({
        where: { id: proposalId, status: "PENDING" },
        data: { status: newStatus },
      });
      if (updateResult.count === 0) {
        throw new Error("Proposal already responded to");
      }

      if (data.action === "ACCEPT") {
        await tx.productCommission.create({
          data: {
            productId,
            rate: current.proposedRate,
            setBy: actorId,
          },
        });

        if (product.status === "APPROVED") {
          await tx.product.update({ where: { id: productId }, data: { status: "LIVE" } });
          flippedToLive = true;
        }
      }

      if (data.action === "COUNTER" && data.counterRate !== undefined) {
        await tx.commissionProposal.create({
          data: {
            productId,
            proposedRate: data.counterRate,
            proposedBy: actorId,
            proposedByType: actorType,
            note: data.note,
            round: current.round + 1,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          sellerId: product.sellerId,
          actorId,
          actorType,
          action: `COMMISSION_${data.action}ED`,
          entityType: "commission_proposal",
          entityId: proposalId,
          metadata: { productId, action: data.action, counterRate: data.counterRate, round: current.round },
        },
      });

      return tx.commissionProposal.findMany({ where: { productId }, orderBy: { round: "asc" } });
    });

    if (flippedToLive) syncProductSearchIndexInBackground(productId);
    return result;
  },

  async listCommissionProposals(
    productId: string,
    actorType: ActorType,
    sellerId: string | undefined,
  ) {
    const product = await db.product.findUnique({ where: { id: productId }, select: { sellerId: true } });
    if (!product) throw new Error("Product not found");
    assertActorAllowed(product, actorType, sellerId);

    return db.commissionProposal.findMany({ where: { productId }, orderBy: { createdAt: "asc" } });
  },

  async listPendingForAdmin() {
    const proposals = await db.commissionProposal.findMany({
      where: {
        status: { in: ["PENDING", "COUNTERED"] },
        proposedByType: "seller",
      },
      include: {
        product: {
          select: { id: true, name: true, sellerId: true },
        },
      },
      orderBy: { updatedAt: "asc" },
    });

    const sellerIds = [...new Set(proposals.map((p) => p.product.sellerId))];
    const sellers = await db.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, name: true, businessName: true },
    });
    const sellerById = new Map(sellers.map((s) => [s.id, s]));

    return proposals.map((p) => ({
      ...p,
      product: {
        ...p.product,
        seller: sellerById.get(p.product.sellerId) ?? null,
      },
    }));
  },
};

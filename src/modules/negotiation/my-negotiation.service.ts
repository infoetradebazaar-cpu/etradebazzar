import { db } from "../../db/index";
import { NEGOTIATION_SESSION_OMIT } from "./negotiation.select";

type ActorType = "customer" | "seller";

export const myNegotiationService = {
  async listSessions(
    actorId: string,
    actorType: ActorType,
    filters: { status?: string; page?: number; limit?: number },
    orgId?: string | null,
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const where: any =
      actorType === "customer"
        ? orgId
          ? { orgId }
          : { customerId: actorId, orgId: null }
        : { sellerId: actorId };
    if (filters.status) where.status = filters.status;

    const [sessions, total] = await Promise.all([
      db.negotiationSession.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        omit: NEGOTIATION_SESSION_OMIT,
      }),
      db.negotiationSession.count({ where }),
    ]);

    // Fetch product and customer info separately (no Prisma relation on NegotiationSession)
    const productIds = [...new Set(sessions.map((s) => s.productId))];
    const customerIds = [...new Set(sessions.map((s) => s.customerId))];

    const [products, customers] = await Promise.all([
      productIds.length > 0
        ? db.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, images: true },
          })
        : Promise.resolve([]),
      customerIds.length > 0
        ? db.user.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const data = sessions.map((s) => ({
      ...s,
      product: productMap.get(s.productId) ?? null,
      customer: customerMap.get(s.customerId) ?? null,
    }));

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  },
};

import { db } from "../../db/index";
import { NEGOTIATION_SESSION_OMIT } from "./negotiation.select";

type ActorType = "customer" | "seller";

export const myNegotiationService = {
  async listSessions(
    actorId: string,
    actorType: ActorType,
    filters: { status?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const where: any = actorType === "customer" ? { customerId: actorId } : { sellerId: actorId };
    if (filters.status) where.status = filters.status;

    const [data, total] = await Promise.all([
      db.negotiationSession.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        omit: NEGOTIATION_SESSION_OMIT,
      }),
      db.negotiationSession.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  },
};

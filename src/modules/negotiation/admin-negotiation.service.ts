import { db } from "../../db/index";
import { NEGOTIATION_SESSION_OMIT } from "./negotiation.select";

export const adminNegotiationService = {
  async listSessions(filters: { mode?: "AUTO" | "MANUAL"; status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const where: any = {};
    if (filters.mode) where.mode = filters.mode;
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

  async getSession(sessionId: string) {
    const session = await db.negotiationSession.findUnique({
      where: { id: sessionId },
      include: {
        rounds: { orderBy: { round: "asc" } },
        chat: { include: { messages: { orderBy: { createdAt: "asc" } } } },
      },
      omit: NEGOTIATION_SESSION_OMIT,
    });
    if (!session) throw new Error("Negotiation session not found");
    return session;
  },
};

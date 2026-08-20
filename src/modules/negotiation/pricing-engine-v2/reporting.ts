import { db } from "../../../db/index";

export interface AcceptanceStats {
  totalSessions: number;
  acceptedSessions: number;
  acceptanceRate: number;
  avgDiscountAtAcceptance: number | null;
}

export interface FormulaVersionStats extends AcceptanceStats {
  formulaVersion: string;
}

export interface EngineFlagsStats extends AcceptanceStats {
  flagsKey: string; // stable JSON.stringify grouping key
  activeEngineFlags: Record<string, unknown> | null; // null for v1_linear, no snapshot taken
}

interface ResolvedSession {
  formulaVersion: string;
  status: string;
  finalPrice: unknown;
  visibleTierPrice: unknown;
  activeEngineFlags: unknown;
}

function summarize(sessions: ResolvedSession[]): AcceptanceStats {
  const accepted = sessions.filter((s) => s.status === "ACCEPTED");
  const discounts = accepted
    .filter((s) => s.finalPrice !== null)
    .map((s) => 1 - Number(s.finalPrice) / Number(s.visibleTierPrice));
  return {
    totalSessions: sessions.length,
    acceptedSessions: accepted.length,
    acceptanceRate: sessions.length > 0 ? accepted.length / sessions.length : 0,
    avgDiscountAtAcceptance:
      discounts.length > 0 ? discounts.reduce((a, b) => a + b, 0) / discounts.length : null,
  };
}

async function loadResolvedSessions(filters?: {
  sellerId?: string;
  skuId?: string;
  since?: Date;
}): Promise<ResolvedSession[]> {
  return db.negotiationSession.findMany({
    where: {
      status: { in: ["ACCEPTED", "REJECTED"] },
      ...(filters?.sellerId ? { sellerId: filters.sellerId } : {}),
      ...(filters?.skuId ? { skuId: filters.skuId } : {}),
      ...(filters?.since ? { createdAt: { gte: filters.since } } : {}),
    },
    select: { formulaVersion: true, status: true, finalPrice: true, visibleTierPrice: true, activeEngineFlags: true },
  });
}

// acceptance rate + avg discount, grouped by v1_linear vs v2_reservation. plain data, no UI here.
export async function getAcceptanceStatsByFormulaVersion(filters?: {
  sellerId?: string;
  skuId?: string;
  since?: Date;
}): Promise<FormulaVersionStats[]> {
  const sessions = await loadResolvedSessions(filters);
  const grouped = new Map<string, ResolvedSession[]>();
  for (const s of sessions) {
    const list = grouped.get(s.formulaVersion) ?? [];
    list.push(s);
    grouped.set(s.formulaVersion, list);
  }
  return [...grouped.entries()].map(([formulaVersion, list]) => ({
    formulaVersion,
    ...summarize(list),
  }));
}

export async function getAcceptanceStatsByEngineFlags(filters?: {
  sellerId?: string;
  skuId?: string;
  since?: Date;
}): Promise<EngineFlagsStats[]> {
  const sessions = await loadResolvedSessions(filters);
  const grouped = new Map<string, { flags: Record<string, unknown> | null; list: ResolvedSession[] }>();
  for (const s of sessions) {
    const flags = (s.activeEngineFlags as Record<string, unknown> | null) ?? null;
    const key = flags ? JSON.stringify(flags, Object.keys(flags).sort()) : "null";
    const entry = grouped.get(key) ?? { flags, list: [] };
    entry.list.push(s);
    grouped.set(key, entry);
  }
  return [...grouped.entries()].map(([flagsKey, { flags, list }]) => ({
    flagsKey,
    activeEngineFlags: flags,
    ...summarize(list),
  }));
}

import { z } from "zod";

export const proposeCommissionSchema = z.object({
  params: z.object({ productId: z.string() }),
  body: z.object({
    rate: z.number().min(0).max(100),
    note: z.string().max(1000).optional(),
  }),
});

export const respondCommissionProposalSchema = z.object({
  params: z.object({ productId: z.string(), proposalId: z.string() }),
  body: z.object({
    action: z.enum(["ACCEPT", "REJECT", "COUNTER"]),
    counterRate: z.number().min(0).max(100).optional(),
    note: z.string().max(1000).optional(),
  }),
});

export const listCommissionProposalsSchema = z.object({
  params: z.object({ productId: z.string() }),
});

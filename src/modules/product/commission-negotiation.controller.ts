import { Request, Response } from "express";
import { commissionNegotiationService } from "./commission-negotiation.service";
import { logger } from "../../utils/logger";

const CLIENT_ERRORS = [
  "Product not found",
  "Product must be APPROVED or LIVE to propose a commission rate",
  "A commission proposal is already open for this product - respond to it instead",
  "Commission proposal not found",
  "Waiting on the other party to respond to this proposal",
  "Proposal already responded to",
];

function isClientError(message: string): boolean {
  return CLIENT_ERRORS.some((prefix) => message.startsWith(prefix)) || message.includes("round limit");
}

async function proposeImpl(req: Request, res: Response, actorType: "seller" | "platform") {
  try {
    const { productId } = req.params;
    const actorId = req.user!.id;
    const sellerId = req.seller?.id;
    const { rate, note } = req.body;
    const result = await commissionNegotiationService.proposeCommission(
      productId as string,
      actorId,
      actorType,
      sellerId,
      { rate, note },
    );
    return res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ err: error.message }, "Propose commission failed");
    if (isClientError(error.message)) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

async function respondImpl(req: Request, res: Response, actorType: "seller" | "platform") {
  try {
    const { productId, proposalId } = req.params;
    const actorId = req.user!.id;
    const sellerId = req.seller?.id;
    const { action, counterRate, note } = req.body;
    const result = await commissionNegotiationService.respondToCommissionProposal(
      productId as string,
      proposalId as string,
      actorId,
      actorType,
      sellerId,
      { action, counterRate, note },
    );
    return res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ err: error.message }, "Respond to commission proposal failed");
    if (isClientError(error.message)) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

async function listImpl(req: Request, res: Response, actorType: "seller" | "platform") {
  try {
    const { productId } = req.params;
    const sellerId = req.seller?.id;
    const result = await commissionNegotiationService.listCommissionProposals(
      productId as string,
      actorType,
      sellerId,
    );
    return res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ err: error.message }, "List commission proposals failed");
    if (isClientError(error.message)) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}

export const commissionNegotiationController = {
  proposeAsSeller: (req: Request, res: Response) => proposeImpl(req, res, "seller"),
  proposeAsAdmin: (req: Request, res: Response) => proposeImpl(req, res, "platform"),
  respondAsSeller: (req: Request, res: Response) => respondImpl(req, res, "seller"),
  respondAsAdmin: (req: Request, res: Response) => respondImpl(req, res, "platform"),
  listAsSeller: (req: Request, res: Response) => listImpl(req, res, "seller"),
  listAsAdmin: (req: Request, res: Response) => listImpl(req, res, "platform"),

  async listPendingForAdmin(_req: Request, res: Response) {
    try {
      const result = await commissionNegotiationService.listPendingForAdmin();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List pending commission proposals (admin) failed");
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
};

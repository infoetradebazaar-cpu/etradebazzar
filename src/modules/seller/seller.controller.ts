import { Request, Response } from "express";
import { sellerService } from "./seller.service";
import { logger } from "../../utils/logger";

export const sellerController = {
  async register(req: Request, res: Response) {
    try {
      const {
        name,
        email,
        password,
        phone,
        businessName,
        businessType,
        address,
        gstin,
        pan,
      } = req.body;
      const result = await sellerService.register({
        name,
        email,
        password,
        phone,
        businessName,
        businessType,
        address,
        gstin,
        pan,
      });
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Seller registration failed");
      if (error.message === "Email already registered") {
        return res.status(409).json({ success: false, error: error.message });
      }
      if (error.message.includes("could not be determined from the provided pincode")) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async completeKyc(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const result = await sellerService.completeKyc(sellerId, req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "KYC submission failed");
      if (error.message === "KYC already submitted") {
        return res.status(409).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async addBankDetail(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const result = await sellerService.addBankDetail(sellerId, req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Bank detail submission failed");
      const clientErrors = ["Bank detail already added", "Seller not found"];
      if (
        clientErrors.includes(error.message) ||
        error.message.includes("Account number") ||
        error.message.includes("IFSC") ||
        error.message.includes("Bank account verification failed")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateBankDetail(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const result = await sellerService.updateBankDetail(sellerId, req.body);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Bank detail update failed");
      const clientErrors = ["Bank detail not found", "Seller not found"];
      if (
        clientErrors.includes(error.message) ||
        error.message.includes("Account number") ||
        error.message.includes("IFSC") ||
        error.message.includes("Bank account verification failed")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getBankDetail(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const result = await sellerService.getBankDetail(sellerId);
      if (!result)
        return res
          .status(404)
          .json({ success: false, error: "Bank detail not found" });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get bank detail failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async inviteSeller(req: Request, res: Response) {
    try {
      const actorId = req.user!.id;
      const { email } = req.body;
      const result = await sellerService.inviteSeller(actorId, email);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Seller invite failed");
      if (error.message === "Seller with this email already exists" || error.message === "Invite already pending for this email") {
        return res.status(409).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async acceptInvite(req: Request, res: Response) {
    try {
      const { token, ...data } = req.body;
      const result = await sellerService.acceptInvite(token, data);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Accept invite failed");
      const clientErrors = [
        "Invalid invite token",
        "Invite already used",
        "Invite expired",
        "City and state could not be determined from the provided pincode. Please provide them manually.",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async approveSeller(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const result = await sellerService.approveSeller(
        sellerId as string,
        actorId,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Seller approval failed");
      const clientErrors = ["Seller not found", "Seller is not pending"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async rejectSeller(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const { reason } = req.body;
      const result = await sellerService.rejectSeller(
        sellerId as string,
        actorId,
        reason,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Seller rejection failed");
      const clientErrors = ["Seller not found", "Seller is not pending"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async suspendSeller(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const { reason } = req.body;
      const result = await sellerService.suspendSeller(
        sellerId as string,
        actorId,
        reason,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Seller suspension failed");
      const clientErrors = ["Seller not found", "Seller already suspended"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async reactivateSeller(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const result = await sellerService.reactivateSeller(
        sellerId as string,
        actorId,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Seller reactivation failed");
      const clientErrors = ["Seller not found", "Seller is not suspended"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listMembers(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { search, role, page, limit } = req.query as Record<string, string>;
      const result = await sellerService.listMembers(sellerId, {
        search,
        role,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List members failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listMembersBySellerId(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const { search, page, limit } = req.query as Record<string, string>;
      const result = await sellerService.listMembers(sellerId, {
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "List members by sellerId failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async addMember(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const result = await sellerService.addMember(sellerId, actorId, req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Add member failed");
      const clientErrors = [
        "User not found",
        "Role not found",
        "User already a member",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateMemberRole(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { memberId } = req.params;
      const { roleId } = req.body;
      const result = await sellerService.updateMemberRole(
        sellerId,
        actorId,
        memberId as string,
        roleId,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update member role failed");
      const clientErrors = ["Member not found", "Role not found"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listPendingSellers(req: Request, res: Response) {
    try {
      const result = await sellerService.listPendingSellers();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List pending sellers failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listAllSellers(req: Request, res: Response) {
    try {
      const { status } = req.query;
      const result = await sellerService.listAllSellers(status as string);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List all sellers failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getSellerById(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const result = await sellerService.getSellerById(sellerId as string);
      if (!result)
        return res
          .status(404)
          .json({ success: false, error: "Seller not found" });
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get seller failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async verifyKyc(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const result = await sellerService.verifyKyc(sellerId as string, actorId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Verify KYC failed");
      const clientErrors = [
        "KYC not found",
        "KYC already verified",
        "Aadhaar must be verified before overall KYC can be verified",
        "Government ID must be verified before overall KYC can be verified",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async rejectKyc(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const { reason } = req.body;
      const result = await sellerService.rejectKyc(
        sellerId as string,
        actorId,
        reason,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Reject KYC failed");
      const clientErrors = ["KYC not found", "Cannot reject verified KYC"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async reverifyBankDetail(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const result = await sellerService.reverifyBankDetail(sellerId as string, actorId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Bank detail reverification failed");
      const clientErrors = ["Bank detail not found", "Seller not found"];
      if (
        clientErrors.includes(error.message) ||
        error.message.includes("Bank account verification failed")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async overrideBankVerification(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const result = await sellerService.overrideBankVerification(
        sellerId as string,
        actorId,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Bank verification override failed");
      const clientErrors = ["Bank detail not found"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async reverifyGstPan(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const result = await sellerService.reverifyGstPan(sellerId as string, actorId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "GST/PAN reverification failed");
      const clientErrors = ["Seller not found", "No GSTIN or PAN on file to reverify"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async overrideGstPanVerification(req: Request, res: Response) {
    try {
      const { sellerId } = req.params;
      const actorId = req.user!.id;
      const result = await sellerService.overrideGstPanVerification(
        sellerId as string,
        actorId,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "GST/PAN verification override failed");
      const clientErrors = [
        "Seller not found",
        "No GSTIN on file to override",
        "No PAN on file to override",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listPendingKyc(req: Request, res: Response) {
    try {
      const result = await sellerService.listPendingKyc();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List pending KYC failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async verifyIfsc(req: Request, res: Response) {
    try {
      const { ifscCode } = req.body;
      const result = await sellerService.verifyIfsc(ifscCode);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Verify IFSC failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async inviteMember(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const result = await sellerService.inviteMember(
        sellerId,
        actorId,
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Invite member failed");
      const clientErrors = [
        "Role not found",
        "User already a member",
        "Invite already pending for this email",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async removeMember(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { memberId } = req.params;
      const result = await sellerService.removeMember(
        sellerId,
        actorId,
        memberId as string,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Remove member failed");
      const clientErrors = ["Member not found", "Cannot remove the owner"];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async listRoles(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const result = await sellerService.listRoles(sellerId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async createRole(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const result = await sellerService.createRole(
        sellerId,
        actorId,
        req.body,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      if (error.message === "Role with this name already exists")
        return res.status(400).json({ success: false, error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateRole(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { roleId } = req.params;
      const result = await sellerService.updateRole(
        sellerId,
        actorId,
        roleId as string,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      const clientErrors = [
        "Role not found",
        "Cannot modify default roles",
        "Role with this name already exists",
      ];
      if (clientErrors.includes(error.message))
        return res.status(400).json({ success: false, error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deleteRole(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { roleId } = req.params;
      const result = await sellerService.deleteRole(
        sellerId,
        actorId,
        roleId as string,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      const clientErrors = [
        "Role not found",
        "Cannot delete default roles",
        "Cannot delete role with active members",
      ];
      if (clientErrors.includes(error.message))
        return res.status(400).json({ success: false, error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
  async listInvites(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const result = await sellerService.listInvites(sellerId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async revokeInvite(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { inviteId } = req.params;
      const result = await sellerService.revokeInvite(
        sellerId,
        inviteId as string,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      const clientErrors = [
        "Invite not found",
        "Invite already used or expired",
      ];
      if (clientErrors.includes(error.message))
        return res.status(400).json({ success: false, error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async resendInvite(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { inviteId } = req.body;
      const result = await sellerService.resendInvite(sellerId, inviteId);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      const clientErrors = [
        "Invite not found",
        "Invite already used or expired",
      ];
      if (clientErrors.includes(error.message))
        return res.status(400).json({ success: false, error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async acceptTeamInvite(req: Request, res: Response) {
    try {
      const { token, ...data } = req.body;
      const result = await sellerService.acceptTeamInvite(token, data);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      const clientErrors = [
        "Invalid invite token",
        "Invite already used or revoked",
        "Invite expired",
      ];
      if (clientErrors.includes(error.message))
        return res.status(400).json({ success: false, error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listRolePermissions(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const { roleId } = req.params;
      const result = await sellerService.listRolePermissions(
        sellerId,
        roleId as string,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      const clientErrors = ["Role not found"];
      if (clientErrors.includes(error.message))
        return res.status(400).json({ success: false, error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateRolePermissions(req: Request, res: Response) {
    try {
      const sellerId = req.seller!.id;
      const actorId = req.user!.id;
      const { roleId } = req.params;
      const { permissions } = req.body;
      const result = await sellerService.updateRolePermissions(
        sellerId,
        actorId,
        roleId as string,
        permissions || [],
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      const clientErrors = [
        "Role not found",
        "Cannot modify owner role permissions",
      ];
      if (clientErrors.includes(error.message))
        return res.status(400).json({ success: false, error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listAllPermissions(req: Request, res: Response) {
    try {
      const result = await sellerService.listAllPermissions();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
};
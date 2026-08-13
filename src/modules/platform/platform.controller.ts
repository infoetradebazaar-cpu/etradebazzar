import { Request, Response } from "express";
import { platformService } from "./platform.service";
import { logger } from "../../utils/logger";

export const platformController = {
  async createRole(req: Request, res: Response) {
    try {
      const result = await platformService.createRole(req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Create role failed");
      if (error.message === "Role already exists") {
        return res.status(409).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateRole(req: Request, res: Response) {
    try {
      const { roleId } = req.params;
      const result = await platformService.updateRole(
        roleId as string,
        req.body,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update role failed");
      const clientErrors = [
        "Role not found",
        "Cannot rename protected role",
        "A role with this name already exists",
      ];
      if (clientErrors.includes(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async deleteRole(req: Request, res: Response) {
    try {
      const { roleId } = req.params;
      await platformService.deleteRole(roleId as string);
      return res.json({ success: true, message: "Role deleted" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Delete role failed");
      const clientErrors = [
        "Role not found",
        "Cannot delete protected role",
        "Role has members  reassign before deleting",
      ];
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
      const result = await platformService.listRoles();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List roles failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listRolePermissions(req: Request, res: Response) {
    try {
      const { roleId } = req.params;
      const result = await platformService.listRolePermissions(roleId as string);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List platform role permissions failed");
      if (error.message === "Role not found") {
        return res.status(404).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async updateRolePermissions(req: Request, res: Response) {
    try {
      const actorId = req.user!.id;
      const { roleId } = req.params;
      const { permissionKeys } = req.body;
      const result = await platformService.updateRolePermissions(
        actorId,
        roleId as string,
        permissionKeys,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Update platform role permissions failed");
      if (
        error.message === "Role not found" ||
        error.message.startsWith("Not platform-scoped permissions") ||
        error.message.startsWith("Unknown permissions")
      ) {
        return res.status(400).json({ success: false, error: error.message });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async listPlatformPermissions(req: Request, res: Response) {
    try {
      const result = await platformService.listPlatformPermissions();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List platform permissions failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async addMember(req: Request, res: Response) {
    try {
      const actorId = req.user!.id;
      const result = await platformService.addMember(actorId, req.body);
      return res.status(201).json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "Add platform member failed");
      const clientErrors = [
        "User not found",
        "Role not found",
        "User is already a platform member",
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
      const actorId = req.user!.id;
      const { memberId } = req.params;
      const { roleId } = req.body;
      const result = await platformService.updateMemberRole(
        actorId,
        memberId as string,
        roleId,
      );
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error(
        { err: error.message },
        "Update platform member role failed",
      );
      const clientErrors = ["Member not found", "Role not found", "Cannot remove last super_admin"];
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
      const actorId = req.user!.id;
      const { memberId } = req.params;
      await platformService.removeMember(actorId, memberId as string);
      return res.json({ success: true, message: "Member removed" });
    } catch (error: any) {
      logger.error({ err: error.message }, "Remove platform member failed");
      const clientErrors = [
        "Member not found",
        "Cannot remove last super_admin",
      ];
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
      const result = await platformService.listMembers();
      return res.json({ success: true, data: result });
    } catch (error: any) {
      logger.error({ err: error.message }, "List platform members failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },

  async getAuditLogs(req: Request, res: Response) {
    try {
      const { sellerId, actorId, action, page, limit } = req.query as Record<string, string>;
      const result = await platformService.getAuditLogs({
        sellerId,
        actorId,
        action,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error: any) {
      logger.error({ err: error.message }, "Get audit logs failed");
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  },
};

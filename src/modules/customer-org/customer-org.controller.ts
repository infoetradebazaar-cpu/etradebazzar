import { Request, Response } from "express";
import { customerOrgService, customerOrgAdminService } from "./customer-org.service";
import { logger } from "../../utils/logger";

const CLIENT_ERRORS = [
    "Organization not found",
    "Role not found",
    "Role with this name already exists",
    "Cannot modify the default admin role",
    "Cannot delete role with active members",
    "Cannot delete role with pending invites",
    "Member not found",
    "User already a member",
    "Invite already pending for this email",
    "Invite not found",
    "Invite already used or expired",
    "Invite already used or revoked",
    "Invalid invite token",
    "Invite expired",
    "Cannot remove the last admin of the organization",
    "Customer org permission catalog not seeded",
    "You can only create one organization. Ask an existing org's admin to invite you instead.",
];

function isClientError(message: string): boolean {
    return CLIENT_ERRORS.includes(message) || message.startsWith("Unknown permissions:");
}

function fail(res: Response, error: any, logMessage: string) {
    logger.error({ err: error.message }, logMessage);
    if (isClientError(error.message)) {
        return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: "Internal server error" });
}

function activeOrgId(req: Request): string {
    return req.customerOrg!.orgId;
}

export const customerOrgController = {
    async registerOrgAccount(req: Request, res: Response) {
        try {
            const result = await customerOrgService.registerOrgAccount(req.body);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Customer org registration failed");
            if (error.message === "Email already registered") {
                return res.status(409).json({ success: false, error: error.message });
            }
            if (
                error.message === "Invalid GSTIN format" ||
                error.message.startsWith("GST registration is")
            ) {
                return res.status(400).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async getBusinessDetails(req: Request, res: Response) {
        try {
            const result = await customerOrgService.getBusinessDetails(activeOrgId(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Get customer org business details failed");
        }
    },

    async updateBusinessDetails(req: Request, res: Response) {
        try {
            const result = await customerOrgService.updateBusinessDetails(
                activeOrgId(req),
                req.user!.id,
                req.body,
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Update customer org business details failed");
        }
    },

    async createOrg(req: Request, res: Response) {
        try {
            const result = await customerOrgService.createOrg(req.user!.id, req.body);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Create customer org failed");
        }
    },

    async listMyOrgs(req: Request, res: Response) {
        try {
            const result = await customerOrgService.listMyOrgs(req.user!.id);
            return res.json({
                success: true,
                data: result,
                meta: { activeOrgId: req.customerOrg?.orgId ?? null },
            });
        } catch (error: any) {
            return fail(res, error, "List my customer orgs failed");
        }
    },

    async getCurrentOrg(req: Request, res: Response) {
        try {
            const result = await customerOrgService.getOrg(activeOrgId(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Get customer org failed");
        }
    },

    async updateCurrentOrg(req: Request, res: Response) {
        try {
            const result = await customerOrgService.updateOrg(activeOrgId(req), req.user!.id, req.body);
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Update customer org failed");
        }
    },

    async listPermissionCatalog(_req: Request, res: Response) {
        try {
            const result = await customerOrgService.listPermissionCatalog();
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "List customer org permission catalog failed");
        }
    },

    async listRoles(req: Request, res: Response) {
        try {
            const result = await customerOrgService.listRoles(activeOrgId(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "List customer org roles failed");
        }
    },

    async createRole(req: Request, res: Response) {
        try {
            const result = await customerOrgService.createRole(activeOrgId(req), req.user!.id, req.body);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Create customer org role failed");
        }
    },

    async updateRole(req: Request, res: Response) {
        try {
            const result = await customerOrgService.updateRole(
                activeOrgId(req),
                req.user!.id,
                String(req.params.roleId),
                req.body,
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Update customer org role failed");
        }
    },

    async deleteRole(req: Request, res: Response) {
        try {
            const result = await customerOrgService.deleteRole(
                activeOrgId(req),
                req.user!.id,
                String(req.params.roleId),
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Delete customer org role failed");
        }
    },

    async listRolePermissions(req: Request, res: Response) {
        try {
            const result = await customerOrgService.listRolePermissions(
                activeOrgId(req),
                String(req.params.roleId),
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "List customer org role permissions failed");
        }
    },

    async updateRolePermissions(req: Request, res: Response) {
        try {
            const result = await customerOrgService.updateRolePermissions(
                activeOrgId(req),
                req.user!.id,
                String(req.params.roleId),
                req.body.permissions,
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Update customer org role permissions failed");
        }
    },

    async listMembers(req: Request, res: Response) {
        try {
            const result = await customerOrgService.listMembers(activeOrgId(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "List customer org members failed");
        }
    },

    async updateMemberRole(req: Request, res: Response) {
        try {
            const result = await customerOrgService.updateMemberRole(
                activeOrgId(req),
                req.user!.id,
                String(req.params.memberId),
                req.body.roleId,
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Update customer org member role failed");
        }
    },

    async removeMember(req: Request, res: Response) {
        try {
            const result = await customerOrgService.removeMember(
                activeOrgId(req),
                req.user!.id,
                String(req.params.memberId),
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Remove customer org member failed");
        }
    },

    async inviteMember(req: Request, res: Response) {
        try {
            const result = await customerOrgService.inviteMember(
                activeOrgId(req),
                req.user!.id,
                req.body,
            );
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Invite customer org member failed");
        }
    },

    async listInvites(req: Request, res: Response) {
        try {
            const result = await customerOrgService.listInvites(activeOrgId(req));
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "List customer org invites failed");
        }
    },

    async revokeInvite(req: Request, res: Response) {
        try {
            const result = await customerOrgService.revokeInvite(
                activeOrgId(req),
                req.user!.id,
                String(req.params.inviteId),
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Revoke customer org invite failed");
        }
    },

    async resendInvite(req: Request, res: Response) {
        try {
            const result = await customerOrgService.resendInvite(
                activeOrgId(req),
                req.user!.id,
                req.body.inviteId,
            );
            return res.json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Resend customer org invite failed");
        }
    },

    async acceptInvite(req: Request, res: Response) {
        try {
            const { token, ...data } = req.body;
            const result = await customerOrgService.acceptInvite(token, data);
            return res.status(201).json({ success: true, data: result });
        } catch (error: any) {
            return fail(res, error, "Accept customer org invite failed");
        }
    },

    async adminListAllOrgs(req: Request, res: Response) {
        try {
            const { search, page, limit } = req.query as Record<string, string>;
            const result = await customerOrgAdminService.listAllOrgs({
                search: search || undefined,
                page: page ? parseInt(page) : undefined,
                limit: limit ? parseInt(limit) : undefined,
            });
            return res.json({ success: true, data: result.data, meta: result.meta });
        } catch (error: any) {
            logger.error({ err: error.message }, "Admin list customer orgs failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },

    async adminGetOrgById(req: Request, res: Response) {
        try {
            const { orgId } = req.params;
            const result = await customerOrgAdminService.getOrgById(orgId);
            if (!result)
                return res.status(404).json({ success: false, error: "Organization not found" });
            return res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error({ err: error.message }, "Admin get customer org failed");
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    },
};

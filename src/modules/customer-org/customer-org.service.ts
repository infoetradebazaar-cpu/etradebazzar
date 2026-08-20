import bcrypt from "bcryptjs";
import { db } from "../../db/index";
import { logger } from "../../utils/logger";
import { config } from "../../../config/config";
import { jwtService } from "../../utils/jwt";
import { creditEngine } from "../../lib/credit-engine/credit-rules";
import { gstService } from "../gst/gst.service";
import { PanFactory } from "../../lib/pan/pan.factory";
import { notificationService } from "../notification/notification.service";
import { EmailFactory } from "../../lib/notifications/email/email.factory";
import { invalidateCustomerOrgContext } from "../../middleware/auth";
import {
    createDefaultCustomerOrgRole,
    invalidateCustomerOrgPermissions,
    getCustomerOrgMemberships,
} from "../../lib/permission/customer-org-permission.service";
import {
    CUSTOMER_ORG_DEFAULT_ROLE_NAME,
    CUSTOMER_ORG_PERMISSION_KEYS,
} from "../../lib/permission/customer-org-permission.constants";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same as TeamInvite


async function invalidateMemberCaches(userId: string, orgId: string) {
    await invalidateCustomerOrgContext(userId);
    await invalidateCustomerOrgPermissions(userId, orgId);
}

async function auditOrg(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
) {
    try {
        await db.auditLog.create({
            data: {
                actorId,
                actorType: "customer_org",
                action,
                entityType,
                entityId,
                metadata: metadata as any,
            },
        });
    } catch (err: any) {
        logger.error({ err: err.message, action, entityId }, "Customer org audit log write failed");
    }
}

function assertRoleEditable(roleName: string) {
    if (roleName === CUSTOMER_ORG_DEFAULT_ROLE_NAME) {
        throw new Error("Cannot modify the default admin role");
    }
}

export const customerOrgService = {
    async registerOrgAccount(data: {
        name: string;
        email: string;
        password: string;
        orgName: string;
        legalEntityName: string;
        gstin: string;
        pan: string;
        businessType: string;
        industry?: string;
    }) {
        const existing = await db.user.findUnique({ where: { email: data.email } });
        if (existing) throw new Error("Email already registered");

        const [gstDetails, panDetails] = await Promise.all([
            gstService.verifyGst(data.gstin),
            PanFactory.get().verifyPan(data.pan),
        ]);
        if (gstDetails.status.toLowerCase() !== "active") {
            throw new Error(`GST registration is ${gstDetails.status} — cannot register`);
        }

        const hashedPassword = await bcrypt.hash(data.password, 12);

        const result = await db.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: { name: data.name, email: data.email, password: hashedPassword },
                select: { id: true, name: true, email: true, isActive: true, createdAt: true },
            });

            const org = await tx.customerOrg.create({
                data: {
                    name: data.orgName,
                    createdBy: user.id,
                    legalEntityName: data.legalEntityName,
                    gstin: data.gstin,
                    pan: data.pan,
                    businessType: data.businessType,
                    industry: data.industry,
                    registeredEmail: data.email,
                    gstVerified: true,
                    panVerified: true,
                    gstVerifiedAt: new Date(),
                    panVerifiedAt: new Date(),
                },
            });

            const role = await createDefaultCustomerOrgRole(tx, org.id);
            const member = await tx.customerOrgMember.create({
                data: { userId: user.id, orgId: org.id, roleId: role.id },
            });

            return { user, org, role, member };
        });

        creditEngine.awardOnboardingBonus(result.user.id).catch(() => null);
        const session = await db.session.create({ data: { userId: result.user.id } });
        const { accessToken, refreshToken } = jwtService.signTokens(
            { sub: result.user.id, email: result.user.email, role: "user" },
            { sessionId: session.id },
        );

        await invalidateMemberCaches(result.user.id, result.org.id);
        await auditOrg(result.user.id, "CUSTOMER_ORG_REGISTERED", "customer_org", result.org.id, {
            gstin: data.gstin,
        });

        logger.info({ userId: result.user.id, orgId: result.org.id }, "Customer org registered");

        return {
            user: result.user,
            org: { id: result.org.id, name: result.org.name },
            accessToken,
            refreshToken,
        };
    },

    async getBusinessDetails(orgId: string) {
        const org = await db.customerOrg.findUnique({
            where: { id: orgId },
            select: {
                id: true, name: true, legalEntityName: true, tradeName: true,
                gstin: true, pan: true, businessType: true, industry: true,
                yearEstablished: true, employees: true, annualTurnover: true,
                website: true, registeredEmail: true,
                gstVerified: true, panVerified: true, gstVerifiedAt: true, panVerifiedAt: true,
            },
        });
        if (!org) throw new Error("Organization not found");
        return org;
    },

    async updateBusinessDetails(
        orgId: string,
        actorId: string,
        data: {
            tradeName?: string;
            businessType?: string;
            industry?: string;
            yearEstablished?: number;
            employees?: string;
            annualTurnover?: string;
            website?: string;
            registeredEmail?: string;
        },
    ) {
        const org = await db.customerOrg.findUnique({ where: { id: orgId } });
        if (!org) throw new Error("Organization not found");

        const updated = await db.customerOrg.update({ where: { id: orgId }, data });

        await auditOrg(actorId, "CUSTOMER_ORG_BUSINESS_DETAILS_UPDATED", "customer_org", orgId, data);
        return updated;
    },

    async createOrg(actorId: string, data: { name: string }) {
        const alreadyCreated = await db.customerOrg.count({ where: { createdBy: actorId } });
        if (alreadyCreated > 0) {
            throw new Error("You can only create one organization. Ask an existing org's admin to invite you instead.");
        }

        let result;
        try {
            result = await db.$transaction(async (tx) => {
                const org = await tx.customerOrg.create({ data: { name: data.name, createdBy: actorId } });
                const role = await createDefaultCustomerOrgRole(tx, org.id);
                const member = await tx.customerOrgMember.create({
                    data: { userId: actorId, orgId: org.id, roleId: role.id },
                });
                return { org, role, member };
            });
        } catch (err: any) {
            
            if (err?.code === "P2002") {
                throw new Error("You can only create one organization. Ask an existing org's admin to invite you instead.");
            }
            throw err;
        }

        await invalidateMemberCaches(actorId, result.org.id);
        await auditOrg(actorId, "CUSTOMER_ORG_CREATED", "customer_org", result.org.id, {
            name: data.name,
        });

        return {
            id: result.org.id,
            name: result.org.name,
            createdAt: result.org.createdAt,
            role: { id: result.role.id, name: result.role.name },
            memberId: result.member.id,
        };
    },

    async listMyOrgs(userId: string) {
        const memberships = await getCustomerOrgMemberships(userId);
        return memberships.map((m) => ({
            orgId: m.orgId,
            orgName: m.orgName,
            memberId: m.memberId,
            role: { id: m.roleId, name: m.roleName },
            createdByMe: m.orgCreatedBy === userId,
        }));
    },

    async getOrg(orgId: string) {
        const org = await db.customerOrg.findUnique({
            where: { id: orgId },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
                _count: { select: { members: true, roles: true } },
            },
        });
        if (!org) throw new Error("Organization not found");
        return {
            id: org.id,
            name: org.name,
            createdAt: org.createdAt,
            updatedAt: org.updatedAt,
            memberCount: org._count.members,
            roleCount: org._count.roles,
        };
    },

    async updateOrg(orgId: string, actorId: string, data: { name: string }) {
        const org = await db.customerOrg.findUnique({ where: { id: orgId } });
        if (!org) throw new Error("Organization not found");

        const updated = await db.customerOrg.update({ where: { id: orgId }, data: { name: data.name } });

        const members = await db.customerOrgMember.findMany({
            where: { orgId },
            select: { userId: true },
        });
        for (const m of members) await invalidateCustomerOrgContext(m.userId);

        await auditOrg(actorId, "CUSTOMER_ORG_UPDATED", "customer_org", orgId, { name: data.name });
        return { id: updated.id, name: updated.name, updatedAt: updated.updatedAt };
    },


    async listPermissionCatalog() {
        return db.customerOrgPermission.findMany({
            select: { id: true, key: true, description: true },
            orderBy: { key: "asc" },
        });
    },

    async listRoles(orgId: string) {
        const roles = await db.customerOrgRole.findMany({
            where: { orgId },
            select: {
                id: true,
                name: true,
                createdAt: true,
                _count: { select: { members: true } },
                permissions: { select: { permission: { select: { key: true } } } },
            },
            orderBy: { createdAt: "asc" },
        });

        return roles.map((r) => ({
            id: r.id,
            name: r.name,
            createdAt: r.createdAt,
            memberCount: r._count.members,
            permissions: r.permissions.map((p) => p.permission.key),
            isDefault: r.name === CUSTOMER_ORG_DEFAULT_ROLE_NAME,
        }));
    },


    async createRole(
        orgId: string,
        actorId: string,
        data: { name: string; permissions?: string[] },
    ) {
        const existing = await db.customerOrgRole.findUnique({
            where: { orgId_name: { orgId, name: data.name } },
        });
        if (existing) throw new Error("Role with this name already exists");

        const permissionIds = await resolveCatalogPermissionIds(data.permissions ?? []);

        const role = await db.$transaction(async (tx) => {
            const created = await tx.customerOrgRole.create({ data: { orgId, name: data.name } });
            if (permissionIds.length) {
                await tx.customerOrgRolePermission.createMany({
                    data: permissionIds.map((permissionId) => ({ roleId: created.id, permissionId })),
                    skipDuplicates: true,
                });
            }
            return created;
        });

        await auditOrg(actorId, "CUSTOMER_ORG_ROLE_CREATED", "customer_org_role", role.id, {
            orgId,
            name: data.name,
            permissions: data.permissions ?? [],
        });

        return { id: role.id, name: role.name, permissions: data.permissions ?? [] };
    },

    async updateRole(orgId: string, actorId: string, roleId: string, data: { name: string }) {
        const role = await db.customerOrgRole.findFirst({ where: { id: roleId, orgId } });
        if (!role) throw new Error("Role not found");
        assertRoleEditable(role.name);

        let updated;
        try {
            updated = await db.customerOrgRole.update({ where: { id: roleId }, data: { name: data.name } });
        } catch (err: any) {
            if (err?.code === "P2002") throw new Error("Role with this name already exists");
            throw err;
        }

        // Cached membership context carries roleName.
        await invalidateRoleHolderCaches(roleId, orgId);
        await auditOrg(actorId, "CUSTOMER_ORG_ROLE_UPDATED", "customer_org_role", roleId, {
            orgId,
            name: data.name,
        });
        return { id: updated.id, name: updated.name };
    },

    async deleteRole(orgId: string, actorId: string, roleId: string) {
        const role = await db.customerOrgRole.findFirst({
            where: { id: roleId, orgId },
            include: { _count: { select: { members: true, invites: true } } },
        });
        if (!role) throw new Error("Role not found");
        assertRoleEditable(role.name);
        if (role._count.members > 0) throw new Error("Cannot delete role with active members");
        if (role._count.invites > 0) throw new Error("Cannot delete role with pending invites");

        await db.customerOrgRole.delete({ where: { id: roleId } });
        await auditOrg(actorId, "CUSTOMER_ORG_ROLE_DELETED", "customer_org_role", roleId, { orgId });
        return { deleted: true };
    },

    async listRolePermissions(orgId: string, roleId: string) {
        const role = await db.customerOrgRole.findFirst({
            where: { id: roleId, orgId },
            select: {
                id: true,
                name: true,
                permissions: { select: { permission: { select: { id: true, key: true } } } },
            },
        });
        if (!role) throw new Error("Role not found");
        return {
            id: role.id,
            name: role.name,
            permissions: role.permissions.map((p) => p.permission.key),
        };
    },

    async updateRolePermissions(
        orgId: string,
        actorId: string,
        roleId: string,
        permissionKeys: string[],
    ) {
        const role = await db.customerOrgRole.findFirst({ where: { id: roleId, orgId } });
        if (!role) throw new Error("Role not found");
        assertRoleEditable(role.name);

        const permissionIds = await resolveCatalogPermissionIds(permissionKeys);

        await db.$transaction(async (tx) => {
            await tx.customerOrgRolePermission.deleteMany({ where: { roleId } });
            if (permissionIds.length) {
                await tx.customerOrgRolePermission.createMany({
                    data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
                    skipDuplicates: true,
                });
            }
        });

        await invalidateRoleHolderCaches(roleId, orgId);
        await auditOrg(
            actorId,
            "CUSTOMER_ORG_ROLE_PERMISSIONS_UPDATED",
            "customer_org_role",
            roleId,
            { orgId, permissions: permissionKeys },
        );

        return { roleId, permissions: permissionKeys };
    },


    async listMembers(orgId: string) {
        const members = await db.customerOrgMember.findMany({
            where: { orgId },
            select: {
                id: true,
                isActive: true,
                createdAt: true,
                user: { select: { id: true, name: true, email: true } },
                role: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "asc" },
        });
        return members;
    },

    async updateMemberRole(orgId: string, actorId: string, memberId: string, roleId: string) {
        const member = await db.customerOrgMember.findFirst({
            where: { id: memberId, orgId },
            include: { role: true },
        });
        if (!member) throw new Error("Member not found");

        const role = await db.customerOrgRole.findFirst({ where: { id: roleId, orgId } });
        if (!role) throw new Error("Role not found");

        if (member.role.name === CUSTOMER_ORG_DEFAULT_ROLE_NAME && role.name !== CUSTOMER_ORG_DEFAULT_ROLE_NAME) {
            await assertNotLastAdmin(orgId, memberId);
        }

        const updated = await db.customerOrgMember.update({
            where: { id: memberId },
            data: { roleId },
        });

        await invalidateMemberCaches(member.userId, orgId);
        await auditOrg(actorId, "CUSTOMER_ORG_MEMBER_ROLE_UPDATED", "customer_org_member", memberId, {
            orgId,
            roleId,
        });
        return { id: updated.id, roleId: updated.roleId };
    },

    async removeMember(orgId: string, actorId: string, memberId: string) {
        const member = await db.customerOrgMember.findFirst({
            where: { id: memberId, orgId },
            include: { role: true },
        });
        if (!member) throw new Error("Member not found");
        if (member.role.name === CUSTOMER_ORG_DEFAULT_ROLE_NAME) {
            await assertNotLastAdmin(orgId, memberId);
        }

        await db.customerOrgMember.delete({ where: { id: memberId } });

        await invalidateMemberCaches(member.userId, orgId);
        await auditOrg(actorId, "CUSTOMER_ORG_MEMBER_REMOVED", "customer_org_member", memberId, {
            orgId,
            userId: member.userId,
        });
        return { removed: true };
    },

    async inviteMember(orgId: string, actorId: string, data: { email: string; roleId: string }) {
        const role = await db.customerOrgRole.findFirst({ where: { id: data.roleId, orgId } });
        if (!role) throw new Error("Role not found");

        const existingUser = await db.user.findUnique({ where: { email: data.email } });
        if (existingUser) {
            const existingMember = await db.customerOrgMember.findUnique({
                where: { userId_orgId: { userId: existingUser.id, orgId } },
            });
            if (existingMember) throw new Error("User already a member");
        }

        const existingInvite = await db.customerOrgInvite.findFirst({
            where: { orgId, email: data.email, status: "PENDING" },
        });
        if (existingInvite) throw new Error("Invite already pending for this email");

        const invite = await db.customerOrgInvite.create({
            data: {
                orgId,
                email: data.email,
                roleId: data.roleId,
                invitedBy: actorId,
                expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            },
        });

        const org = await db.customerOrg.findUnique({ where: { id: orgId }, select: { name: true } });
        await sendInviteEmail({
            email: data.email,
            existingUserId: existingUser?.id,
            orgName: org?.name ?? "an organization",
            roleName: role.name,
            token: invite.token,
            isReminder: false,
        });

        await auditOrg(actorId, "CUSTOMER_ORG_MEMBER_INVITED", "customer_org_invite", invite.id, {
            orgId,
            email: data.email,
            roleId: data.roleId,
        });

        return {
            id: invite.id,
            email: invite.email,
            status: invite.status,
            expiresAt: invite.expiresAt,
            role: { id: role.id, name: role.name },
        };
    },

    async listInvites(orgId: string) {
        return db.customerOrgInvite.findMany({
            where: { orgId, status: "PENDING" },
            select: {
                id: true,
                email: true,
                status: true,
                expiresAt: true,
                createdAt: true,
                role: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
        });
    },

    async revokeInvite(orgId: string, actorId: string, inviteId: string) {
        const invite = await db.customerOrgInvite.findFirst({ where: { id: inviteId, orgId } });
        if (!invite) throw new Error("Invite not found");
        if (invite.status !== "PENDING") throw new Error("Invite already used or expired");

        const updated = await db.customerOrgInvite.update({
            where: { id: inviteId },
            data: { status: "REVOKED" },
        });
        await auditOrg(actorId, "CUSTOMER_ORG_INVITE_REVOKED", "customer_org_invite", inviteId, { orgId });
        return { id: updated.id, status: updated.status };
    },

    async resendInvite(orgId: string, actorId: string, inviteId: string) {
        const invite = await db.customerOrgInvite.findFirst({
            where: { id: inviteId, orgId },
            select: {
                id: true,
                email: true,
                status: true,
                token: true,
                role: { select: { id: true, name: true } },
            },
        });
        if (!invite) throw new Error("Invite not found");
        if (invite.status !== "PENDING") throw new Error("Invite already used or expired");

        const updated = await db.customerOrgInvite.update({
            where: { id: inviteId },
            data: { expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
        });

        const [org, existingUser] = await Promise.all([
            db.customerOrg.findUnique({ where: { id: orgId }, select: { name: true } }),
            db.user.findUnique({ where: { email: invite.email } }),
        ]);

        await sendInviteEmail({
            email: invite.email,
            existingUserId: existingUser?.id,
            orgName: org?.name ?? "an organization",
            roleName: invite.role.name,
            token: invite.token,
            isReminder: true,
        });

        await auditOrg(actorId, "CUSTOMER_ORG_INVITE_RESENT", "customer_org_invite", inviteId, { orgId });
        return { id: updated.id, expiresAt: updated.expiresAt };
    },

    async acceptInvite(token: string, data: { name: string; password: string }) {
        const invite = await db.customerOrgInvite.findUnique({ where: { token } });
        if (!invite) throw new Error("Invalid invite token");
        if (invite.status !== "PENDING") throw new Error("Invite already used or revoked");
        if (invite.expiresAt < new Date()) throw new Error("Invite expired");

        let user = await db.user.findUnique({ where: { email: invite.email } });

        if (user) {
            const existingSellerMembership = await db.sellerMember.findFirst({
                where: { userId: user.id },
            });
            if (existingSellerMembership) {
                throw new Error(
                    "This email is already registered as a seller team member and cannot be used for a customer organization.",
                );
            }

            const passwordMatches = await bcrypt.compare(data.password, user.password);
            if (!passwordMatches) {
                throw new Error(
                    "An account with this email already exists. Enter its password to accept this invite.",
                );
            }
        }

        const result = await db.$transaction(async (tx) => {
            if (!user) {
                const hashedPassword = await bcrypt.hash(data.password, 12);
                user = await tx.user.create({
                    data: { name: data.name, email: invite.email, password: hashedPassword },
                });
            }

            const member = await tx.customerOrgMember.create({
                data: { userId: user.id, orgId: invite.orgId, roleId: invite.roleId },
            });

            await tx.customerOrgInvite.update({ where: { token }, data: { status: "ACCEPTED" } });

            return { user: user!, member };
        });

        await invalidateMemberCaches(result.user.id, invite.orgId);
        await auditOrg(
            result.user.id,
            "CUSTOMER_ORG_INVITE_ACCEPTED",
            "customer_org_invite",
            invite.id,
            { orgId: invite.orgId, memberId: result.member.id },
        );

        return {
            user: { id: result.user.id, email: result.user.email, name: result.user.name },
            member: {
                id: result.member.id,
                orgId: result.member.orgId,
                roleId: result.member.roleId,
            },
        };
    },
};

async function resolveCatalogPermissionIds(permissionKeys: string[]): Promise<string[]> {
    if (!permissionKeys.length) return [];

    const unique = [...new Set(permissionKeys)];

    const outOfCatalog = unique.filter(
        (k) => !(CUSTOMER_ORG_PERMISSION_KEYS as string[]).includes(k),
    );
    if (outOfCatalog.length) {
        throw new Error(`Unknown permissions: ${outOfCatalog.join(", ")}`);
    }

    const permissions = await db.customerOrgPermission.findMany({
        where: { key: { in: unique } },
        select: { id: true, key: true },
    });

    const found = new Set(permissions.map((p) => p.key));
    const missing = unique.filter((k) => !found.has(k));
    if (missing.length) {
        throw new Error(`Unknown permissions: ${missing.join(", ")}`);
    }

    return permissions.map((p) => p.id);
}

async function invalidateRoleHolderCaches(roleId: string, orgId: string) {
    const holders = await db.customerOrgMember.findMany({
        where: { roleId },
        select: { userId: true },
    });
    for (const h of holders) await invalidateMemberCaches(h.userId, orgId);
}

async function assertNotLastAdmin(orgId: string, excludingMemberId: string) {
    const remainingAdmins = await db.customerOrgMember.count({
        where: {
            orgId,
            isActive: true,
            id: { not: excludingMemberId },
            role: { name: CUSTOMER_ORG_DEFAULT_ROLE_NAME },
        },
    });
    if (remainingAdmins === 0) {
        throw new Error("Cannot remove the last admin of the organization");
    }
}

async function sendInviteEmail(input: {
    email: string;
    existingUserId?: string;
    orgName: string;
    roleName: string;
    token: string;
    isReminder: boolean;
}) {
    const inviteUrl = `${config.customerAppUrl}/organization/invite?token=${input.token}`;
    const subject = input.isReminder
        ? "Reminder: You've been invited to join an organization"
        : "You've been invited to join an organization";
    const emailData = {
        businessName: input.orgName,
        roleName: input.roleName,
        inviteUrl,
        isReminder: input.isReminder,
    };

    if (input.existingUserId) {
        notificationService
            .notify({
                userId: input.existingUserId,
                email: input.email,
                type: "TEAM_INVITE" as any,
                title: subject,
                message: `You've been invited to join ${input.orgName} on ETradeBazaar as ${input.roleName}.`,
                channels: ["email", "sse"],
                emailTemplate: "team-invite",
                emailData,
                data: { token: input.token },
            })
            .catch(() => null);
    } else {
        EmailFactory.get()
            .send({ to: input.email, subject, template: "team-invite", data: emailData })
            .catch((err: any) =>
                logger.error({ err: err.message }, "Customer org invite email failed"),
            );
    }
}

export const customerOrgAdminService = {
    async listAllOrgs(filters: {
        search?: string;
        page?: number;
        limit?: number;
    }) {
        const page = filters.page || 1;
        const limit = Math.min(filters.limit || 20, 100);
        const skip = (page - 1) * limit;

        const where: any = {};
        if (filters.search) {
            where.OR = [
                { name: { contains: filters.search, mode: "insensitive" } },
                { legalEntityName: { contains: filters.search, mode: "insensitive" } },
                { gstin: { contains: filters.search, mode: "insensitive" } },
                { registeredEmail: { contains: filters.search, mode: "insensitive" } },
            ];
        }

        const [orgs, total] = await Promise.all([
            db.customerOrg.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    legalEntityName: true,
                    gstin: true,
                    pan: true,
                    businessType: true,
                    industry: true,
                    registeredEmail: true,
                    gstVerified: true,
                    panVerified: true,
                    createdAt: true,
                    _count: { select: { members: true } },
                },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
            }),
            db.customerOrg.count({ where }),
        ]);

        return {
            data: orgs.map((o) => ({
                ...o,
                memberCount: o._count?.members ?? 0,
                _count: undefined,
            })),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1,
            },
        };
    },

    async getOrgById(orgId: string) {
        const org = await db.customerOrg.findUnique({
            where: { id: orgId },
            select: {
                id: true,
                name: true,
                legalEntityName: true,
                tradeName: true,
                gstin: true,
                pan: true,
                businessType: true,
                industry: true,
                yearEstablished: true,
                employees: true,
                annualTurnover: true,
                website: true,
                registeredEmail: true,
                gstVerified: true,
                panVerified: true,
                gstVerifiedAt: true,
                panVerifiedAt: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        id: true,
                        isActive: true,
                        createdAt: true,
                        user: { select: { id: true, name: true, email: true, isActive: true } },
                        role: { select: { id: true, name: true } },
                    },
                    orderBy: { createdAt: "asc" },
                },
            },
        });

        if (!org) return null;
        return org;
    },
};

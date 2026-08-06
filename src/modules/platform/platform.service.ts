import { db } from "../../db/index";
import { redis, RedisKeys } from "../../db/redis";

export const platformService = {
  async createRole(data: { name: string; description?: string }) {
    const existing = await db.platformRole.findUnique({
      where: { name: data.name },
    });
    if (existing) throw new Error("Role already exists");

    return db.platformRole.create({ data });
  },

  async updateRole(
    roleId: string,
    data: { name?: string; description?: string },
  ) {
    const role = await db.platformRole.findUnique({ where: { id: roleId } });
    if (!role) throw new Error("Role not found");

    const protected_roles = [
      "super_admin",
      "onboarding_manager",
      "product_reviewer",
    ];
    if (data.name && protected_roles.includes(role.name)) {
      throw new Error("Cannot rename protected role");
    }

    return db.platformRole.update({ where: { id: roleId }, data });
  },

  async deleteRole(roleId: string) {
    const role = await db.platformRole.findUnique({
      where: { id: roleId },
      include: { _count: { select: { members: true } } },
    });
    if (!role) throw new Error("Role not found");

    const protected_roles = [
      "super_admin",
      "onboarding_manager",
      "product_reviewer",
    ];
    if (protected_roles.includes(role.name))
      throw new Error("Cannot delete protected role");
    if (role._count.members > 0)
      throw new Error("Role has members  reassign before deleting");

    return db.platformRole.delete({ where: { id: roleId } });
  },

  async listRoles() {
    return db.platformRole.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  async addMember(actorId: string, data: { email: string; roleId: string }) {
    const user = await db.user.findUnique({ where: { email: data.email } });
    if (!user) throw new Error("User not found");

    const role = await db.platformRole.findUnique({
      where: { id: data.roleId },
    });
    if (!role) throw new Error("Role not found");

    const existing = await db.platformMember.findUnique({
      where: { userId: user.id },
    });
    if (existing) throw new Error("User is already a platform member");

    const member = await db.platformMember.create({
      data: { userId: user.id, roleId: data.roleId },
    });

    await db.auditLog.create({
      data: {
        actorId,
        actorType: "platform",
        action: "PLATFORM_MEMBER_ADDED",
        entityType: "platform_member",
        entityId: member.id,
        metadata: { email: data.email, roleId: data.roleId },
      },
    });

    return member;
  },

  async updateMemberRole(actorId: string, memberId: string, roleId: string) {
    const member = await db.platformMember.findUnique({
      where: { id: memberId },
      include: { role: true },
    });
    if (!member) throw new Error("Member not found");

    const role = await db.platformRole.findUnique({ where: { id: roleId } });
    if (!role) throw new Error("Role not found");

    if (member.role.name === "super_admin" && role.name !== "super_admin") {
      const superAdminCount = await db.platformMember.count({
        where: { role: { name: "super_admin" } },
      });
      if (superAdminCount <= 1) {
        throw new Error("Cannot remove last super_admin");
      }
    }

    const updated = await db.platformMember.update({
      where: { id: memberId },
      data: { roleId },
    });

    await redis.del(RedisKeys.userRoles(member.userId, "platform"));

    await db.auditLog.create({
      data: {
        actorId,
        actorType: "platform",
        action: "PLATFORM_MEMBER_ROLE_UPDATED",
        entityType: "platform_member",
        entityId: memberId,
        metadata: { roleId },
      },
    });

    return updated;
  },

  async removeMember(actorId: string, memberId: string) {
    const member = await db.platformMember.findUnique({
      where: { id: memberId },
      include: { role: true },
    });
    if (!member) throw new Error("Member not found");
    if (member.role.name === "super_admin") {
      const superAdminCount = await db.platformMember.count({
        where: { role: { name: "super_admin" } },
      });
      if (superAdminCount <= 1)
        throw new Error("Cannot remove last super_admin");
    }

    await db.platformMember.delete({ where: { id: memberId } });
    await redis.del(RedisKeys.userRoles(member.userId, "platform"));

    await db.auditLog.create({
      data: {
        actorId,
        actorType: "platform",
        action: "PLATFORM_MEMBER_REMOVED",
        entityType: "platform_member",
        entityId: memberId,
      },
    });
  },

  async listMembers() {
    const members = await db.platformMember.findMany({
      select: {
        id: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
        role: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return members.map((m) => ({
      id: m.id,
      name: m.user.name ?? "",
      email: m.user.email,
      roleId: m.role.id,
      role: m.role,
      isActive: m.user.isActive,
      createdAt: m.createdAt,
    }));
  },

  async getAuditLogs(filters: {
    sellerId?: string;
    actorId?: string;
    action?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 100, 100);

    const where = {
      ...(filters.sellerId && { sellerId: filters.sellerId }),
      ...(filters.actorId && { actorId: filters.actorId }),
      ...(filters.action && { action: filters.action }),
    };

    const [data, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          seller: { select: { id: true, name: true, businessName: true, email: true } },
        },
      }),
      db.auditLog.count({ where }),
    ]);

    // Batch-lookup actor names for platform actors (User table)
    const platformActorIds = Array.from(
      new Set(
        data
          .filter((l) => l.actorType === "platform")
          .map((l) => l.actorId),
      ),
    );
    const sellerActorIds = Array.from(
      new Set(
        data
          .filter((l) => l.actorType === "seller")
          .map((l) => l.actorId),
      ),
    );

    const [platformUsers, sellerActors] = await Promise.all([
      platformActorIds.length
        ? db.user.findMany({
            where: { id: { in: platformActorIds } },
            select: { id: true, name: true, email: true },
          })
        : [],
      sellerActorIds.length
        ? db.seller.findMany({
            where: { id: { in: sellerActorIds } },
            select: { id: true, name: true, businessName: true, email: true },
          })
        : [],
    ]);

    const userMap = new Map(platformUsers.map((u) => [u.id, u]));
    const sellerMap = new Map(sellerActors.map((s) => [s.id, s]));

    const enrichedData = data.map((log) => {
      const actor =
        log.actorType === "platform"
          ? userMap.get(log.actorId)
          : sellerMap.get(log.actorId);
      return {
        ...log,
        actorName: actor?.name || null,
        actorEmail: actor?.email || null,
        actorBusinessName:
          log.actorType === "seller"
            ? (actor as { businessName?: string })?.businessName || null
            : null,
      };
    });

    return { data: enrichedData, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  },
};

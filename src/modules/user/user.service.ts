import { db } from "../../db/index";

export const userService = {
  async listUsers(filters: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      AND: [
        { platformMember: { is: null } },
        { sellerMemberships: { none: {} } },
        { customerOrgMemberships: { none: {} } },
      ],
    };
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    if (filters.status === "active") where.AND.push({ isActive: true });
    if (filters.status === "inactive") where.AND.push({ isActive: false });

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          phoneVerifiedAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    const data = users.map((u) => ({
      id: u.id,
      name: u.name || "",
      email: u.email,
      role: "user" as const,
      phone: u.phone,
      phoneVerifiedAt: u.phoneVerifiedAt,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  },

  async getUserById(userId: string) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        phoneVerifiedAt: true,
        platformMember: { select: { role: { select: { name: true } } } },
        sellerMemberships: {
          select: { seller: { select: { id: true, name: true, businessName: true } } },
          take: 1,
        },
        customerOrgMemberships: {
          select: { org: { select: { id: true, name: true } } },
          take: 1,
        },
        addresses: {
          select: {
            id: true,
            label: true,
            line1: true,
            line2: true,
            city: true,
            state: true,
            pincode: true,
            isDefault: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) return null;

    let role = "user";
    if (user.platformMember) {
      role = user.platformMember.role.name;
    } else if (user.sellerMemberships.length > 0) {
      role = "seller";
    }

    return {
      id: user.id,
      name: user.name || "",
      email: user.email,
      phone: user.phone,
      isActive: user.isActive,
      role,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      seller: user.sellerMemberships[0]?.seller ?? null,
      customerOrg: user.customerOrgMemberships[0]?.org ?? null,
      addresses: user.addresses,
    };
  },
};

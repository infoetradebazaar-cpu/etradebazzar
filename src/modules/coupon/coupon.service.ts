import { db } from "../../db/index";
import type { Prisma } from "../../../prisma/generated/client";
import { redis } from "../../db/redis";
import { randomBytes } from "crypto";
import { acquireLock, releaseLock } from "../../lib/locks/redis-lock";

const COUPON_LOCK_TTL = 15;

async function acquireCouponLock(couponId: string): Promise<string | null> {
  return acquireLock(`coupon:lock:${couponId}`, COUPON_LOCK_TTL);
}

async function releaseCouponLock(couponId: string, token: string): Promise<void> {
  await releaseLock(`coupon:lock:${couponId}`, token);
}

function generateCode(prefix: string, length = 8): string {
  return `${prefix}-${randomBytes(length).toString("hex").toUpperCase().slice(0, length)}`;
}

export const couponService = {
  async createCoupon(
    actorId: string,
    data: {
      code: string;
      type: "PERCENTAGE" | "FIXED";
      value: number;
      currency?: string;
      minOrder?: number;
      maxUses?: number;
      perUserLimit?: number;
      expiresAt?: string;
      isStackable?: boolean;
      scopeType?: "ALL" | "CATEGORY" | "PRODUCT" | "USER_SEGMENT";
      scopeIds?: string[];
      firstTimeOnly?: boolean;
      userSegment?: string;
    },
  ) {
    const existing = await db.coupon.findUnique({ where: { code: data.code } });
    if (existing) throw new Error("Coupon code already exists");
    if (data.type === "PERCENTAGE" && data.value > 100) {
      throw new Error("Percentage discount cannot exceed 100%");
    }

    return db.coupon.create({
      data: {
        code: data.code.toUpperCase(),
        type: data.type,
        value: data.value,
        currency: data.currency ?? "INR",
        minOrder: data.minOrder,
        maxUses: data.maxUses,
        perUserLimit: data.perUserLimit ?? 1,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        isStackable: data.isStackable ?? false,
        scopeType: data.scopeType ?? "ALL",
        scopeIds: data.scopeIds ?? [],
        firstTimeOnly: data.firstTimeOnly ?? false,
        userSegment: data.userSegment,
        createdBy: actorId,
      },
    });
  },

  async bulkGenerateCoupons(
    actorId: string,
    data: {
      prefix: string;
      count: number;
      type: "PERCENTAGE" | "FIXED";
      value: number;
      currency?: string;
      minOrder?: number;
      expiresAt?: string;
      scopeType?: "ALL" | "CATEGORY" | "PRODUCT" | "USER_SEGMENT";
      scopeIds?: string[];
    },
  ) {
    if (data.count > 1000)
      throw new Error("Cannot generate more than 1000 codes at once");
    if (data.type === "PERCENTAGE" && data.value > 100) {
      throw new Error("Percentage discount cannot exceed 100%");
    }

    const bulkGroupId = randomBytes(8).toString("hex");
    const codes: string[] = [];
    while (codes.length < data.count) {
      const code = generateCode(data.prefix);
      if (!codes.includes(code)) codes.push(code);
    }

    const result = await db.coupon.createMany({
      data: codes.map((code) => ({
        code,
        type: data.type,
        value: data.value,
        currency: data.currency ?? "INR",
        minOrder: data.minOrder,
        maxUses: 1,
        perUserLimit: 1,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        scopeType: data.scopeType ?? "ALL",
        scopeIds: data.scopeIds ?? [],
        isBulk: true,
        bulkGroupId,
        createdBy: actorId,
      })),
      skipDuplicates: true,
    });

    await db.auditLog.create({
      data: {
        actorId,
        actorType: "platform",
        action: "BULK_COUPONS_GENERATED",
        entityType: "coupon",
        entityId: bulkGroupId,
        metadata: { count: data.count, prefix: data.prefix, bulkGroupId },
      },
    });

    return { bulkGroupId, generated: result.count, prefix: data.prefix };
  },

  async _checkValidity(
    coupon: NonNullable<Awaited<ReturnType<typeof db.coupon.findUnique>>>,
    userId: string,
    orderAmount: number,
    productIds?: string[],
    categoryIds?: string[],
  ) {
    if (!coupon.isActive) throw new Error("Coupon is not active");
    if (coupon.expiresAt && coupon.expiresAt < new Date())
      throw new Error("Coupon has expired");
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses)
      throw new Error("Coupon usage limit reached");
    if (coupon.minOrder && orderAmount < Number(coupon.minOrder)) {
      throw new Error(
        `Minimum order amount for this coupon is ₹${coupon.minOrder}`,
      );
    }

    const userUsageCount = await db.couponUsage.count({
      where: { couponId: coupon.id, userId },
    });
    if (userUsageCount >= coupon.perUserLimit)
      throw new Error("You have already used this coupon");

    if (coupon.firstTimeOnly) {
      const prevOrders = await db.order.count({
        where: { customerId: userId, status: "DELIVERED" },
      });
      if (prevOrders > 0)
        throw new Error("This coupon is for first-time buyers only");
    }

    if (coupon.scopeType === "PRODUCT" && productIds?.length) {
      const valid = productIds.some((id) => coupon.scopeIds.includes(id));
      if (!valid) throw new Error("Coupon not applicable for these products");
    }
    if (coupon.scopeType === "CATEGORY" && categoryIds?.length) {
      const valid = categoryIds.some((id) => coupon.scopeIds.includes(id));
      if (!valid) throw new Error("Coupon not applicable for these categories");
    }
  },

  async validateCoupon(
    code: string,
    userId: string,
    orderAmount: number,
    productIds?: string[],
    categoryIds?: string[],
  ) {
    const coupon = await db.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!coupon) throw new Error("Invalid coupon code");

    await this._checkValidity(coupon, userId, orderAmount, productIds, categoryIds);

    const discount =
      coupon.type === "PERCENTAGE"
        ? (orderAmount * Number(coupon.value)) / 100
        : Math.min(Number(coupon.value), orderAmount);

    return {
      coupon: {
        id: coupon.id,
        code: coupon.code,
        type: coupon.type,
        value: Number(coupon.value),
      },
      discount: parseFloat(discount.toFixed(2)),
      finalAmount: parseFloat((orderAmount - discount).toFixed(2)),
    };
  },

  /**
   * @param createOrder Callback that creates the order given the discount and coupon.
   */
  async checkoutWithCoupon<T extends { id: string }>(
    code: string,
    userId: string,
    orderAmount: number,
    productIds: string[] | undefined,
    createOrder: (discount: number, couponCode: string, couponId: string) => Promise<T>,
  ): Promise<{ order: T; discount: number }> {
    const coupon = await db.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!coupon) throw new Error("Invalid coupon code");

    await this._checkValidity(coupon, userId, orderAmount, productIds);

    const discount =
      coupon.type === "PERCENTAGE"
        ? parseFloat(((orderAmount * Number(coupon.value)) / 100).toFixed(2))
        : Math.min(Number(coupon.value), orderAmount);

    const order = await createOrder(discount, coupon.code, coupon.id);
    return { order, discount };
  },


  async claimInTransaction(
    tx: Prisma.TransactionClient,
    couponId: string,
    userId: string,
    orderId: string,
    discount: number,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`coupon:${couponId}:${userId}`}))`;

    const coupon = await tx.coupon.findUnique({
      where: { id: couponId },
      select: { perUserLimit: true, maxUses: true, isActive: true, expiresAt: true },
    });
    if (!coupon) throw new Error("Invalid coupon code");

    const used = await tx.couponUsage.count({ where: { couponId, userId } });
    if (used >= coupon.perUserLimit) throw new Error("You have already used this coupon");

    const claimed = await tx.coupon.updateMany({
      where: {
        id: couponId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(coupon.maxUses ? { usedCount: { lt: coupon.maxUses } } : {}),
      },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      if (!coupon.isActive) throw new Error("Coupon is not active");
      if (coupon.expiresAt && coupon.expiresAt <= new Date()) throw new Error("Coupon has expired");
      throw new Error("Coupon usage limit reached");
    }

    await tx.couponUsage.create({ data: { couponId, userId, orderId, discount } });
  },

  /**
   * @deprecated for the checkout path - use checkoutWithCoupon instead,
   * which holds the lock across order creation so the discount can never
   * be priced into an order the coupon claim then fails to honor. Kept for
   * any other caller that applies a coupon to an ALREADY-committed order
   */
  async applyCoupon(
    couponId: string,
    userId: string,
    orderId: string,
    discount: number,
  ) {
    const locked = await acquireCouponLock(couponId);
    if (!locked)
      throw new Error("Coupon is being processed  try again in a moment");

    try {
      await db.$transaction(async (tx) => {
        const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
        if (!coupon) throw new Error("Coupon not found");
        if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
          throw new Error("Coupon usage limit reached");
        }

        const userUsageCount = await tx.couponUsage.count({
          where: { couponId, userId },
        });
        if (userUsageCount >= coupon.perUserLimit) {
          throw new Error("You have already used this coupon");
        }

        await tx.couponUsage.create({
          data: { couponId, userId, orderId, discount },
        });
        await tx.coupon.update({
          where: { id: couponId },
          data: { usedCount: { increment: 1 } },
        });
        await tx.order.update({
          where: { id: orderId },
          data: { discountAmount: discount },
        });
      });
    } finally {
      await releaseCouponLock(couponId, locked);
    }
  },

  async updateCoupon(
    couponId: string,
    data: Partial<{
      isActive: boolean;
      expiresAt: string;
      maxUses: number;
      minOrder: number;
    }>,
  ) {
    const coupon = await db.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new Error("Coupon not found");

    return db.coupon.update({
      where: { id: couponId },
      data: {
        ...data,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });
  },

  async deactivateCoupon(couponId: string, actorId: string) {
    const coupon = await db.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new Error("Coupon not found");

    const updated = await db.coupon.update({
      where: { id: couponId },
      data: { isActive: false },
    });

    await db.auditLog.create({
      data: {
        actorId,
        actorType: "platform",
        action: "COUPON_DEACTIVATED",
        entityType: "coupon",
        entityId: couponId,
      },
    });

    return updated;
  },

  async listCoupons(filters?: { isActive?: boolean; scopeType?: string }) {
    return db.coupon.findMany({
      where: {
        ...(filters?.isActive !== undefined && { isActive: filters.isActive }),
        ...(filters?.scopeType && { scopeType: filters.scopeType as any }),
        isBulk: false,
      },
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        currency: true,
        minOrder: true,
        maxUses: true,
        usedCount: true,
        perUserLimit: true,
        expiresAt: true,
        isActive: true,
        isStackable: true,
        scopeType: true,
        scopeIds: true,
        firstTimeOnly: true,
        createdAt: true,
        _count: { select: { usages: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async getCoupon(couponId: string) {
    const coupon = await db.coupon.findUnique({
      where: { id: couponId },
      include: {
        usages: {
          select: {
            userId: true,
            orderId: true,
            discount: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });
    if (!coupon) throw new Error("Coupon not found");
    return coupon;
  },
};

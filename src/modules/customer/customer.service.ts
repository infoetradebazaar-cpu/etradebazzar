import { db } from "../../db/index";
import bcrypt from "bcryptjs";
import { creditEngine } from "../../lib/credit-engine/credit-rules";
import { jwtService } from "../../utils/jwt";
import { logger } from "../../utils/logger";
import { otpService } from "../../lib/otp/otp.service";

const PHONE_LINK_PURPOSE = "phone-link";

export const customerService = {
  async register(data: {
    name: string;
    email: string;
    password: string;
    phone: string;
    address: { street: string; city: string; state: string; pincode: string };
  }) {
    const existing = await db.user.findUnique({ where: { email: data.email } });
    if (existing) throw new Error("Email already registered");

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: data.name, email: data.email, password: hashedPassword },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          createdAt: true,
        },
      });

      await tx.customerAddress.create({
        data: {
          userId: user.id,
          receiverName: data.name,
          phone: data.phone,
          street: data.address.street,
          city: data.address.city,
          state: data.address.state,
          pincode: data.address.pincode,
          isDefault: true,
        },
      });

      return user;
    });

    creditEngine.awardOnboardingBonus(result.id).catch(() => null);
    const session = await db.session.create({
      data: { userId: result.id },
    });

    const { accessToken, refreshToken } = jwtService.signTokens({
        sub: result.id,
        email: result.email, 
        role: "user",
      },{ sessionId: session.id },);

    logger.info({ userId: result.id, sessionId: session.id }, "Customer registered");

    return { user: result, accessToken, refreshToken };
  },

  async getProfile(userId: string) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new Error("User not found");
    return user;
  },

  async updateProfile(userId: string, data: { name?: string }) {
    const updated = await db.user.update({ where: { id: userId }, data });
    creditEngine.checkProfileCompletion(userId).catch(() => null);
    return updated;
  },

  async requestPhoneLink(userId: string, phone: string) {
    const existing = await db.user.findUnique({ where: { phone } });
    if (existing && existing.id !== userId) {
      throw new Error("Phone number already linked to another account");
    }
    await otpService.requestOtp(PHONE_LINK_PURPOSE, phone);
    return { sent: true };
  },

  async verifyPhoneLink(userId: string, phone: string, otp: string) {
    const valid = await otpService.verifyOtp(PHONE_LINK_PURPOSE, phone, otp);
    if (!valid) throw new Error("Invalid or expired OTP");

    const existing = await db.user.findUnique({ where: { phone } });
    if (existing && existing.id !== userId) {
      throw new Error("Phone number already linked to another account");
    }

    return db.user.update({
      where: { id: userId },
      data: { phone, phoneVerifiedAt: new Date() },
      select: { id: true, phone: true, phoneVerifiedAt: true },
    });
  },

  async listMyOrders(
    userId: string,
    filters: { status?: string; page?: number; limit?: number },
    orgId?: string | null,
  ) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const where: any = orgId ? { orgId } : { customerId: userId, orgId: null };
    if (filters.status) where.status = filters.status;

    const [data, total] = await Promise.all([
      db.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  images: { take: 1, orderBy: { order: "asc" } },
                },
              },
            },
          },
          seller: { select: { id: true, businessName: true } },
          shipments: {
            select: { status: true, trackingId: true, trackingUrl: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.order.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },
};

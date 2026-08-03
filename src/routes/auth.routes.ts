import { Router } from "express";
import { db } from "../db/index";
import { jwtService } from "../utils/jwt";
import { validate } from "../utils/validate";
import { z } from "zod";
import { logger } from "../utils/logger";
import { protect } from "../middleware/auth";
import { redis, RedisKeys } from "../db/redis";
import { authLimiter, otpLimiter } from "../middleware/rate-limit";
import bcrypt from "bcryptjs";
import { ah } from "../utils/async-handler";
import { otpService } from "../lib/otp/otp.service";

const router: Router = Router();

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),
});

const otpRequestSchema = z.object({
  body: z.object({ phone: z.string().min(10).max(15) }),
});

const otpVerifySchema = z.object({
  body: z.object({
    phone: z.string().min(10).max(15),
    otp: z.string().length(6),
  }),
});

const LOGIN_OTP_PURPOSE = "login";

const DUMMY_HASH = "$2b$10$q/Cw9LzIerrEJshd1W4luOz/GrNRkxASaqxYhaUtQcUpfap/LkNSO";

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

async function deriveRole(userId: string): Promise<string> {
  const [platformMember, sellerMember] = await Promise.all([
    db.platformMember.findFirst({
      where: { userId },
      select: { role: { select: { name: true } } },
    }),
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
      return tx.sellerMember.findFirst({
        where: { userId, isActive: true },
        select: { sellerId: true },
      });
    }),
  ]);

  if (platformMember?.role?.name) return platformMember.role.name;
  if (sellerMember?.sellerId) return "seller";
  return "user";
}

async function issueSession(
  user: { id: string; email: string; name: string | null },
  req: { ip?: string; get: (h: string) => string | undefined },
) {
  const session = await db.session.create({
    data: {
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent") ?? undefined,
    },
  });

  const role = await deriveRole(user.id);

  const { accessToken, refreshToken } = jwtService.signTokens(
    { sub: user.id, email: user.email, role },
    { sessionId: session.id },
  );

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  logger.info({ userId: user.id, sessionId: session.id }, "User logged in");

  return { accessToken, refreshToken, user };
}

router.post("/login", authLimiter, validate(loginSchema),
  ah(async (req, res) => {
    const { email, password } = req.body;

    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        isActive: true,
      },
    });

    const passwordValid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);

    if (!user || !passwordValid) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, error: "Account disabled" });
    }

    const session = await db.session.create({
      data: {
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.get("User-Agent") ?? undefined,
      },
    });

    const [platformMember, sellerMember] = await Promise.all([
    db.platformMember.findFirst({
      where: { userId: user.id },
      select: { role: { select: { name: true } } },
    }),
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
      return tx.sellerMember.findFirst({
        where: { userId: user.id, isActive: true },
        select: { sellerId: true },
      });
    }),
    ]);

    let role = "user";
    if (platformMember?.role?.name) {
      role = platformMember.role.name;
    } else if (sellerMember?.sellerId) {
      role = "seller";
    }

    const { accessToken, refreshToken } = jwtService.signTokens({
      sub: user.id,
      email: user.email,
      role,
    });

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    logger.info({ userId: user.id, sessionId: session.id }, "User logged in");

    res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name ?? undefined },
    });
  }),
);

router.post("/otp/request", authLimiter, otpLimiter, validate(otpRequestSchema),
  ah(async (req, res) => {
    const { phone } = req.body;

    const user = await db.user.findFirst({
      where: { phone, phoneVerifiedAt: { not: null } },
      select: { isActive: true },
    });
    if (user?.isActive) {
      await otpService.requestOtp(LOGIN_OTP_PURPOSE, phone);
    }

    res.json({ success: true, message: "If this phone is linked to an account, an OTP has been sent" });
  }),
);

router.post("/otp/verify", authLimiter, validate(otpVerifySchema),
  ah(async (req, res) => {
    const { phone, otp } = req.body;

    const valid = await otpService.verifyOtp(LOGIN_OTP_PURPOSE, phone, otp);
    if (!valid) {
      return res.status(401).json({ success: false, error: "Invalid or expired OTP" });
    }

    const user = await db.user.findFirst({
      where: { phone, phoneVerifiedAt: { not: null } },
      select: { id: true, email: true, name: true, isActive: true },
    });
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid or expired OTP" });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, error: "Account disabled" });
    }

    const { accessToken, refreshToken } = await issueSession(user, req);

    res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name ?? undefined },
    });
  }),
);

router.post("/logout", protect, ah(async (req, res) => {
  const auth = req.headers.authorization!;
  const token = auth.split(" ")[1];
  const payload = jwtService.verifyToken(token as string, "access");

  if (payload.jti) {
    const ttl = payload.exp
      ? payload.exp - Math.floor(Date.now() / 1000)
      : 900;
    if (ttl > 0) {
      await redis.setex(RedisKeys.tokenBlacklist(payload.jti), ttl, "1");
    }
  }

  const refreshCookie = req.cookies?.refreshToken;
  if (refreshCookie) {
    await jwtService.revokeRefreshFamily(refreshCookie);
  }

  if (req.sessionId) {
    await db.session.update({ where: { id: req.sessionId }, data: { revoked: true } }).catch(() => null);
  }

  res.clearCookie("refreshToken", { httpOnly: true, sameSite: "strict" });

  logger.info({ userId: req.user!.id }, "User logged out");
  return res.json({ success: true, message: "Logged out" });
}),
);

router.post("/refresh", authLimiter, ah(async (req, res) => {
  const oldRefreshToken = req.cookies?.refreshToken || req.body.refreshToken;

  if (!oldRefreshToken) {
    return res.status(401).json({ error: "No refresh token provided" });
  }

  try {
    const { accessToken, refreshToken } =
      await jwtService.refreshToken(oldRefreshToken);

    res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);
    return res.json({ success: true, accessToken, refreshToken });
  } catch (error: any) {
    if (error.message === "Refresh token reuse detected") {
      logger.error(
        { ip: req.ip, userAgent: req.get("User-Agent") },
        "SECURITY: refresh token reuse detected on /refresh"
      );
      res.clearCookie("refreshToken", { httpOnly: true, sameSite: "strict" });
      return res.status(401).json({ error: "Session invalidated, please log in again" });
    }
    return res.status(401).json({ error: "Invalid refresh token" });
  }
}),
);

router.get("/me", protect, ah(async (req, res) => {
  if (!req.user)
    return res.status(401).json({ success: false, error: "Unauthorized" });

  const [sellerMemberships, platformMember] = await Promise.all([
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
      return tx.sellerMember.findMany({
        where: { userId: req.user!.id, isActive: true },
        select: {
          sellerId: true,
          role: {
            select: {
              name: true,
              permissions: {
                select: { permission: { select: { key: true } } },
              },
            },
          },
          seller: { select: { businessName: true, status: true } },
        },
      });
    }),
    db.platformMember.findUnique({
      where: { userId: req.user.id },
      select: { role: { select: { name: true } } },
    }),
  ]);

  return res.json({
    success: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    },
    contexts: {
      isCustomer: true,
      isPlatformAdmin: !!platformMember,
      platformRole: platformMember?.role.name ?? null,
      sellerMemberships: sellerMemberships.map((m) => ({
        sellerId: m.sellerId,
        role: m.role.name,
        businessName: m.seller.businessName,
        sellerStatus: m.seller.status,
        permissions: m.role.permissions.map((p) => p.permission.key),
      })),
    },
  });
}),
);

export default router;

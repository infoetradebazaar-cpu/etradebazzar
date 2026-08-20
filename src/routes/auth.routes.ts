import { Router } from "express";
import crypto from "crypto";
import { db } from "../db/index";
import { jwtService } from "../utils/jwt";
import { validate } from "../utils/validate";
import { z } from "zod";
import { logger } from "../utils/logger";
import { protect } from "../middleware/auth";
import { redis, RedisKeys } from "../db/redis";
import { authLimiter, otpLimiter, passwordResetLimiter, mfaLoginLimiter } from "../middleware/rate-limit";
import bcrypt from "bcryptjs";
import { ah } from "../utils/async-handler";
import { otpService } from "../lib/otp/otp.service";
import { checkLockout, recordFailedLogin, resetFailedLogins } from "../lib/auth/account-lockout";
import { EmailFactory } from "../lib/notifications/email/email.factory";
import { config } from "../../config/config";
import { strongPasswordSchema } from "../utils/password-policy";
import { securityService } from "../modules/security/security.service";

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
const RESET_TOKEN_TTL_SECS = 30 * 60;
const MFA_CHALLENGE_TTL_SECS = 5 * 60;

const mfaLoginVerifySchema = z.object({
  body: z.object({
    challengeId: z.string().uuid(),
    token: z.string().min(6).max(11),
  }),
});

const mfaLoginResendSchema = z.object({
  body: z.object({ challengeId: z.string().uuid() }),
});

const forgotPasswordSchema = z.object({
  body: z.object({ email: z.string().email() }),
});

const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1),
    newPassword: strongPasswordSchema,
  }),
});

function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

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
    const lockoutId = String(email).trim().toLowerCase();

    const existingLock = await checkLockout(lockoutId);
    if (existingLock.locked) {
      res.setHeader("Retry-After", existingLock.retryAfterSecs!);
      return res.status(429).json({
        success: false,
        error: "Too many failed sign-in attempts please try again later",
        retryAfter: existingLock.retryAfterSecs,
      });
    }

    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        isActive: true,
        twoFactorEnabled: true,
        twoFactorMethod: true,
      },
    });

    const passwordValid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);

    if (!user || !passwordValid) {
      const failure = await recordFailedLogin(lockoutId);

      if (failure.justLocked) {
        if (user) {
          EmailFactory.get()
            .send({
              to: user.email,
              template: "account-locked",
              subject: "Your account was temporarily locked",
              data: { name: user.name || "there", retryAfterMinutes: Math.ceil(failure.retryAfterSecs! / 60) },
            })
            .catch((err: any) => logger.error({ err: err.message }, "Failed to send account-locked email"));
        }
        res.setHeader("Retry-After", failure.retryAfterSecs!);
        return res.status(429).json({
          success: false,
          error: "Too many failed sign-in attempts please try again later",
          retryAfter: failure.retryAfterSecs,
        });
      }

      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    await resetFailedLogins(lockoutId);

    if (!user.isActive) {
      return res.status(403).json({ success: false, error: "Account disabled" });
    }

    if (user.twoFactorEnabled) {
      const challengeId = crypto.randomUUID();
      const method = (user.twoFactorMethod ?? "totp") as "totp" | "email";

      await redis.setex(
        RedisKeys.mfaLoginChallenge(challengeId),
        MFA_CHALLENGE_TTL_SECS,
        JSON.stringify({ userId: user.id }),
      );

      if (method === "email") {
        await securityService.requestTwoFactorEmailCode(user.id, "2fa-login");
      }

      return res.json({
        success: true,
        mfaRequired: true,
        challengeId,
        method,
      });
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

router.post("/2fa/login-verify", authLimiter, mfaLoginLimiter, validate(mfaLoginVerifySchema),
  ah(async (req, res) => {
    const { challengeId, token } = req.body;

    const raw = await redis.get(RedisKeys.mfaLoginChallenge(challengeId));
    if (!raw) {
      return res.status(400).json({ success: false, error: "This login attempt has expired, please sign in again" });
    }
    const { userId } = JSON.parse(raw) as { userId: string };

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isActive: true },
    });
    if (!user || !user.isActive) {
      return res.status(403).json({ success: false, error: "Account disabled" });
    }

    let valid: boolean;
    try {
      valid = await securityService.verifyTwoFactorToken(userId, token, "2fa-login");
    } catch (error: any) {
      return res.status(400).json({ success: false, error: error.message });
    }
    if (!valid) {
      return res.status(401).json({ success: false, error: "Invalid or expired code" });
    }

    await redis.del(RedisKeys.mfaLoginChallenge(challengeId));

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

router.post("/2fa/login-resend", authLimiter, mfaLoginLimiter, validate(mfaLoginResendSchema),
  ah(async (req, res) => {
    const { challengeId } = req.body;

    const raw = await redis.get(RedisKeys.mfaLoginChallenge(challengeId));
    if (!raw) {
      return res.status(400).json({ success: false, error: "This login attempt has expired, please sign in again" });
    }
    const { userId } = JSON.parse(raw) as { userId: string };

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { twoFactorMethod: true },
    });

    if (user?.twoFactorMethod === "email") {
      await securityService.requestTwoFactorEmailCode(userId, "2fa-login");
    }

    res.json({ success: true, message: "If applicable, a new code has been sent" });
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

router.post("/forgot-password", authLimiter, passwordResetLimiter, validate(forgotPasswordSchema),
  ah(async (req, res) => {
    const email = String(req.body.email).trim().toLowerCase();

    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        platformMember: { select: { id: true } },
        sellerMemberships: { select: { id: true }, take: 1 },
      },
    });

    const ipAddress = req.ip;
    const userAgent = req.get("User-Agent") ?? undefined;

    if (user?.isActive) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(rawToken);

      // Invalidate any previously issued token for this user before issuing a new one
      const previousHash = await redis.get(RedisKeys.passwordResetRequest(user.id));
      if (previousHash) {
        await redis.del(RedisKeys.passwordResetToken(previousHash));
      }

      await redis.setex(RedisKeys.passwordResetToken(tokenHash), RESET_TOKEN_TTL_SECS, user.id);
      await redis.setex(RedisKeys.passwordResetRequest(user.id), RESET_TOKEN_TTL_SECS, tokenHash);

      const resetBaseUrl = user.platformMember
        ? config.platformAppUrl
        : user.sellerMemberships.length > 0
          ? config.sellerAppUrl
          : config.appUrl;
      const resetUrl = `${resetBaseUrl}/reset-password?token=${rawToken}`;

      EmailFactory.get()
        .send({
          to: user.email,
          template: "password-reset",
          subject: "Reset your password",
          data: {
            name: user.name || "there",
            resetUrl,
            expiresInMinutes: RESET_TOKEN_TTL_SECS / 60,
            requestIp: ipAddress,
            requestTime: new Date().toUTCString(),
          },
        })
        .catch((err: any) => logger.error({ err: err.message }, "Failed to send password-reset email"));

      await db.auditLog
        .create({
          data: {
            actorId: user.id,
            actorType: "user",
            action: "PASSWORD_RESET_REQUESTED",
            entityType: "user",
            entityId: user.id,
            ipAddress,
            userAgent,
          },
        })
        .catch((err: any) => logger.error({ err: err.message }, "Failed to write password-reset audit log"));
    }

    res.json({
      success: true,
      message: "If that email is registered, a password reset link has been sent",
    });
  }),
);

router.post("/reset-password", authLimiter, passwordResetLimiter, validate(resetPasswordSchema),
  ah(async (req, res) => {
    const { token, newPassword } = req.body;
    const tokenHash = hashResetToken(token);

    const userId = await redis.get(RedisKeys.passwordResetToken(tokenHash));
    if (!userId) {
      return res.status(400).json({ success: false, error: "Invalid or expired reset link" });
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isActive: true, password: true },
    });
    if (!user || !user.isActive) {
      return res.status(400).json({ success: false, error: "Invalid or expired reset link" });
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
    if (sameAsCurrent) {
      return res.status(400).json({
        success: false,
        error: "New password must be different from your current password",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await db.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, passwordChangedAt: new Date() },
    });

    await redis.del(RedisKeys.passwordResetToken(tokenHash));
    await redis.del(RedisKeys.passwordResetRequest(user.id));
    await redis.del(RedisKeys.authContext(user.id));

    await db.session.updateMany({
      where: { userId: user.id, revoked: false },
      data: { revoked: true },
    });

    const ipAddress = req.ip;
    const userAgent = req.get("User-Agent") ?? undefined;

    logger.info({ userId: user.id, ipAddress }, "Password reset completed");

    EmailFactory.get()
      .send({
        to: user.email,
        template: "password-changed",
        subject: "Your password was changed",
        data: {
          name: user.name || "there",
          changeIp: ipAddress,
          changeTime: new Date().toUTCString(),
        },
      })
      .catch((err: any) => logger.error({ err: err.message }, "Failed to send password-changed email"));

    await db.auditLog
      .create({
        data: {
          actorId: user.id,
          actorType: "user",
          action: "PASSWORD_RESET_COMPLETED",
          entityType: "user",
          entityId: user.id,
          ipAddress,
          userAgent,
        },
      })
      .catch((err: any) => logger.error({ err: err.message }, "Failed to write password-reset audit log"));

    res.json({ success: true, message: "Password has been reset successfully" });
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
    const oldPayload = jwtService.verifyToken(oldRefreshToken, "refresh");
    if (oldPayload.sub) {
      const user = await db.user.findUnique({
        where: { id: oldPayload.sub },
        select: { passwordChangedAt: true },
      });
      if (user?.passwordChangedAt && oldPayload.iat) {
        const passwordChangedAtSecs = Math.floor(user.passwordChangedAt.getTime() / 1000);
        if (oldPayload.iat < passwordChangedAtSecs) {
          res.clearCookie("refreshToken", { httpOnly: true, sameSite: "strict" });
          return res.status(401).json({ error: "Session invalidated, please log in again" });
        }
      }
    }

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

import crypto from "crypto";
import { redis, RedisKeys } from "../../db/redis";
import { SmsFactory } from "../notifications/sms/sms.factory";

const OTP_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;

function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export const otpService = {
  async requestOtp(purpose: string, phone: string): Promise<void> {
    const otp = generateOtp();
    await redis.setex(RedisKeys.otpCode(purpose, phone), OTP_TTL_SECONDS, hashOtp(otp));
    await redis.del(RedisKeys.otpAttempts(purpose, phone));
    await SmsFactory.get().sendOtp({ to: phone, otp, expiry: OTP_TTL_SECONDS / 60 });
  },

  async verifyOtp(purpose: string, phone: string, code: string): Promise<boolean> {
    const attemptsKey = RedisKeys.otpAttempts(purpose, phone);
    const attempts = await redis.incr(attemptsKey);
    if (attempts === 1) await redis.expire(attemptsKey, OTP_TTL_SECONDS);

    if (attempts > MAX_ATTEMPTS) {
      throw new Error("Too many attempts, request a new OTP");
    }

    const codeKey = RedisKeys.otpCode(purpose, phone);
    const stored = await redis.get(codeKey);
    if (!stored) return false;

    const storedBuf = Buffer.from(stored, "hex");
    const providedBuf = Buffer.from(hashOtp(code), "hex");
    if (storedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(storedBuf, providedBuf)) {
      return false;
    }

    await redis.del(codeKey);
    await redis.del(attemptsKey);
    return true;
  },
};

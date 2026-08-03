import { redis, RedisKeys } from "../../db/redis";
import { SmsFactory } from "../notifications/sms/sms.factory";

const OTP_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const otpService = {
  async requestOtp(purpose: string, phone: string): Promise<void> {
    const otp = generateOtp();
    await redis.setex(RedisKeys.otpCode(purpose, phone), OTP_TTL_SECONDS, otp);
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
    if (!stored || stored !== code) return false;

    await redis.del(codeKey);
    await redis.del(attemptsKey);
    return true;
  },
};

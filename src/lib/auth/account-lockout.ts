import { redis } from "../../db/redis";

const LOCKOUT_THRESHOLD = 5;
const BASE_BACKOFF_SECS = 30;
const MAX_BACKOFF_SECS = 3600;
const FAILURE_COUNTER_TTL_SECS = MAX_BACKOFF_SECS * 2;

function failureKey(identifier: string): string {
  return `login-failures:${identifier}`;
}

function lockKey(identifier: string): string {
  return `login-lock:${identifier}`;
}

export interface LockoutStatus {
  locked: boolean;
  retryAfterSecs?: number;
}

export async function checkLockout(identifier: string): Promise<LockoutStatus> {
  const ttl = await redis.ttl(lockKey(identifier));
  if (ttl > 0) return { locked: true, retryAfterSecs: ttl };
  return { locked: false };
}

export interface RecordFailureResult {
  failureCount: number;
  justLocked: boolean;
  retryAfterSecs?: number;
}

export async function recordFailedLogin(identifier: string): Promise<RecordFailureResult> {
  const key = failureKey(identifier);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, FAILURE_COUNTER_TTL_SECS);

  if (count < LOCKOUT_THRESHOLD) {
    return { failureCount: count, justLocked: false };
  }

  const backoffSecs = Math.min(
    BASE_BACKOFF_SECS * 2 ** (count - LOCKOUT_THRESHOLD),
    MAX_BACKOFF_SECS,
  );
  await redis.setex(lockKey(identifier), backoffSecs, "1");

  return { failureCount: count, justLocked: true, retryAfterSecs: backoffSecs };
}

export async function resetFailedLogins(identifier: string): Promise<void> {
  await Promise.all([redis.del(failureKey(identifier)), redis.del(lockKey(identifier))]);
}

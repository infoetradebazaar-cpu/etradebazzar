import { randomUUID } from "crypto";
import { redis } from "../../db/redis";

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function acquireLock(key: string, ttlSecs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await redis.set(key, token, "EX", ttlSecs, "NX");
    return result === "OK" ? token : null;
}

export async function releaseLock(key: string, token: string): Promise<void> {
    await redis.eval(RELEASE_SCRIPT, 1, key, token);
}
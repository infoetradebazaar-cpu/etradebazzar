import { db } from "../../db/index";
import { decrypt } from "../../utils/encryption";

const TTL_MS = 30_000;
const cache = new Map<string, { value: string | null; expires: number }>();

async function readEncrypted(key: string): Promise<string | null> {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const row = await db.platformConfig.findUnique({ where: { key } });
    const value = row?.value ?? null;
    cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
}

export function invalidatePlatformConfig(key?: string): void {
    if (key) cache.delete(key);
    else cache.clear();
}

export async function getPlatformConfig(key: string): Promise<string> {
    const value = await readEncrypted(key);
    if (value === null) throw new Error(`Platform config not found: ${key}`);
    return decrypt(value);
}
export async function getPlatformConfigBool(key: string, defaultValue: boolean): Promise<boolean> {
    const value = await readEncrypted(key);
    if (value === null) return defaultValue;
    return decrypt(value) === "true";
}

export async function getPlatformConfigNumber(key: string, defaultValue: number): Promise<number> {
    const value = await readEncrypted(key);
    if (value === null) return defaultValue;
    const n = Number(decrypt(value));
    return Number.isFinite(n) ? n : defaultValue;
}

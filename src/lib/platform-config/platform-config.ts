import { db } from "../../db/index";
import { decrypt } from "../../utils/encryption";

export async function getPlatformConfig(key: string): Promise<string> {
    const config = await db.platformConfig.findUnique({ where: { key } });
    if (!config) throw new Error(`Platform config not found: ${key}`);
    return decrypt(config.value);
}
export async function getPlatformConfigBool(key: string, defaultValue: boolean): Promise<boolean> {
    const config = await db.platformConfig.findUnique({ where: { key } });
    if (!config) return defaultValue;
    return decrypt(config.value) === "true";
}

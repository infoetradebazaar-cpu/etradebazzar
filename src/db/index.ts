import { PrismaClient } from "../../prisma/generated/client";
import { logger } from "../utils/logger";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config } from "../../config/config";

declare global {
  var prisma: PrismaClient | undefined;
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX ?? 20),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  logger.error({ err: err.message }, "Unexpected Postgres pool error");
});

const adapter = new PrismaPg(pool);

export const db =
  globalThis.prisma ??
  new PrismaClient({
    adapter,
    log: [
      { emit: "stdout", level: "error" },
      { emit: "stdout", level: "warn" },
    ],
  });

if (config.nodeEnv !== "production") {
  globalThis.prisma = db;
}

let isConnected = false;

export async function connectDb(maxAttempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.$connect();
      isConnected = true;
      logger.info("Prisma connected to Postgres");
      return;
    } catch (error: any) {
      logger.error({ attempt, err: error.message }, "Prisma connection failed");
      if (attempt >= maxAttempts) {
        throw new Error("Max database connection attempts reached");
      }
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      logger.info(`Retrying DB connection in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function isDbConnected(): boolean {
  return isConnected;
}

export async function disconnectDb(): Promise<void> {
  await db.$disconnect();
  await pool.end();
  isConnected = false;
  logger.info("Prisma disconnected");
}
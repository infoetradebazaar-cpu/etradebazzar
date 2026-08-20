import { db } from "./index";
import { logger } from "../utils/logger";
import { readFileSync } from "fs";
import { join } from "path";
import { analyticsRegistry } from "../lib/analytics/analytics.registry";

async function runRLSMigration() {
  try {
    await db.$executeRawUnsafe(`
      DO $$ BEGIN
        DROP POLICY IF EXISTS tenant_isolation ON shops;
        DROP POLICY IF EXISTS tenant_isolation ON products;
        DROP POLICY IF EXISTS tenant_isolation ON seller_members;
        DROP POLICY IF EXISTS tenant_isolation ON seller_roles;
        DROP POLICY IF EXISTS customer_org_isolation ON carts;
        DROP POLICY IF EXISTS customer_org_isolation ON orders;
        DROP POLICY IF EXISTS customer_org_isolation ON negotiation_sessions;
      END $$;
    `);

    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/rls_setup.sql"),
      "utf-8"
    );
    await db.$executeRawUnsafe(sql);
    logger.info("RLS migration applied");
  } catch (error: any) {
    logger.error({ err: error.message }, "RLS migration failed");
    process.exit(1);
  }
}

async function createAnalyticsViews() {
  try {
    await analyticsRegistry.createAll();
    logger.info("Analytics materialized views created");
  } catch (err: any) {
    logger.warn({ err: err.message }, "Analytics views creation skipped - may already exist");
  }
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_MIGRATE !== "true") {
    logger.error("Refusing to run migrate.ts against production without ALLOW_PROD_MIGRATE=true");
    process.exit(1);
  }
  await runRLSMigration();
  await createAnalyticsViews();
  process.exit(0);
}

main();
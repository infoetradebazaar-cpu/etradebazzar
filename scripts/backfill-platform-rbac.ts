/**
 * Backfills PlatformRole -> Permission grants to match current
 * requirePlatformAdmin() string-check behavior exactly
 *
 */
import { db } from "../src/db/index";
import { logger } from "../src/utils/logger";
import {
  seedPlatformPermissions,
  DEFAULT_PLATFORM_ROLE_PERMISSIONS,
} from "../src/lib/permission/permission.service";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_RBAC_BACKFILL !== "true") {
    logger.error(
      "Refusing to run backfill-platform-rbac.ts against production without ALLOW_PROD_RBAC_BACKFILL=true",
    );
    process.exit(1);
  }

  console.log("Platform RBAC backfill about to grant:\n");
  for (const [roleName, keys] of Object.entries(DEFAULT_PLATFORM_ROLE_PERMISSIONS)) {
    console.log(`  ${roleName} (${keys.length} permissions):`);
    for (const key of [...keys].sort()) console.log(`    - ${key}`);
    console.log("");
  }

  const roles = await db.platformRole.findMany({
    where: { name: { in: Object.keys(DEFAULT_PLATFORM_ROLE_PERMISSIONS) } },
    select: { id: true, name: true },
  });

  const missing = Object.keys(DEFAULT_PLATFORM_ROLE_PERMISSIONS).filter(
    (name) => !roles.some((r) => r.name === name),
  );
  if (missing.length) {
    logger.error({ missing }, "Expected PlatformRole rows not found run platform seed first");
    process.exit(1);
  }

  let totalGranted = 0;

  await db.$transaction(async (tx) => {
    await seedPlatformPermissions(tx);

    const allKeys = [...new Set(Object.values(DEFAULT_PLATFORM_ROLE_PERMISSIONS).flat())];
    const permissions = await tx.permission.findMany({
      where: { key: { in: allKeys } },
      select: { id: true, key: true },
    });

    if (permissions.length !== allKeys.length) {
      throw new Error("Platform permission catalog not fully seeded - aborting backfill");
    }
    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

    for (const role of roles) {
      const keys = DEFAULT_PLATFORM_ROLE_PERMISSIONS[role.name] ?? [];
      const result = await tx.platformRolePermission.createMany({
        data: keys.map((key) => ({
          roleId: role.id,
          permissionId: permissionIdByKey.get(key)!,
        })),
        skipDuplicates: true,
      });
      totalGranted += result.count;
    }
  });

  console.log(`Backfill complete - ${totalGranted} new grant(s) written (existing grants left as-is).`);
  console.log("The legacy requirePlatformAdmin() string checks are UNCHANGED and still gate every route.");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err.message }, "Platform RBAC backfill failed");
  process.exit(1);
});

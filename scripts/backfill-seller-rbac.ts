/**
 * Backfills SellerRole -> Permission grants for the Epic 7 permission keys
 */
import { db } from "../src/db/index";
import { logger } from "../src/utils/logger";
import { seedPlatformPermissions, DEFAULT_ROLE_PERMISSIONS } from "../src/lib/permission/permission.service";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_RBAC_BACKFILL !== "true") {
    logger.error(
      "Refusing to run backfill-seller-rbac.ts against production without ALLOW_PROD_RBAC_BACKFILL=true",
    );
    process.exit(1);
  }

  console.log("Seller RBAC backfill about to grant (per matching role name):\n");
  for (const [roleName, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    console.log(`  ${roleName} (${keys.length} permissions):`);
    for (const key of [...keys].sort()) console.log(`    - ${key}`);
    console.log("");
  }

  const roles = await db.sellerRole.findMany({
    where: { name: { in: Object.keys(DEFAULT_ROLE_PERMISSIONS) } },
    select: { id: true, name: true, sellerId: true },
  });
  console.log(`Found ${roles.length} matching roles across all sellers.`);

  let totalGranted = 0;

  await db.$transaction(async (tx) => {
    await seedPlatformPermissions(tx);

    const allKeys = [...new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat())];
    const permissions = await tx.permission.findMany({
      where: { key: { in: allKeys } },
      select: { id: true, key: true },
    });
    if (permissions.length !== allKeys.length) {
      throw new Error("Permission catalog not fully seeded aborting backfill");
    }
    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

    for (const role of roles) {
      const keys = DEFAULT_ROLE_PERMISSIONS[role.name] ?? [];
      const result = await tx.rolePermission.createMany({
        data: keys.map((key) => ({
          roleId: role.id,
          permissionId: permissionIdByKey.get(key)!,
        })),
        skipDuplicates: true,
      });
      totalGranted += result.count;
    }
  });

  console.log(`Backfill complete - ${totalGranted} new grant(s) written across ${roles.length} roles (existing grants left as-is).`);
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err.message }, "Seller RBAC backfill failed");
  process.exit(1);
});

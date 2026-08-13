import { db } from "./index";
import { logger } from "../utils/logger";
import bcrypt from "bcryptjs";
import { seedPlatformPermissions } from "../lib/permission/permission.service";
import crypto from "crypto";

async function seed() {
  if (process.env.NODE_ENV === "production") {
    logger.error("Refusing to run seed.ts with NODE_ENV=production");
    process.exit(1);
  }

  logger.info("Running seed...");

  const existing = await db.platformMember.findFirst({
    include: { role: true },
    where: { role: { name: "super_admin" } },
  });

  if (existing) {
    logger.info("super_admin already exists  skipping");
    process.exit(0);
  }

  const generatedPassword = crypto.randomBytes(12).toString("base64url");
  const password = await bcrypt.hash(generatedPassword, 12);

  await db.$transaction(async (tx) => {
    await seedPlatformPermissions(tx);

    const role = await tx.platformRole.upsert({
      where: { name: "super_admin" },
      update: {},
      create: { name: "super_admin", description: "Full platform access" },
    });

    await tx.platformRole.upsert({
      where: { name: "onboarding_manager" },
      update: {},
      create: {
        name: "onboarding_manager",
        description: "Manages seller onboarding",
      },
    });

    await tx.platformRole.upsert({
      where: { name: "product_reviewer" },
      update: {},
      create: {
        name: "product_reviewer",
        description: "Reviews and approves products",
      },
    });

    const user = await tx.user.create({
      data: {
        name: "Super Admin",
        email: "admin@etradebazaar.com",
        password,
      },
    });

    await tx.platformMember.create({
      data: { userId: user.id, roleId: role.id },
    });
  });

  console.log("super_admin created");
  console.log("  email:    admin@etradebazaar.com");
  console.log(`  password: ${generatedPassword}`);
  console.log("Store this securely and rotate it after first login.");

  process.exit(0);
}

seed().catch((err) => {
  logger.error({ err: err.message }, "Seed failed");
  process.exit(1);
});
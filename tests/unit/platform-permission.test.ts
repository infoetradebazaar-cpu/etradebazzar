import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import {
  requirePlatformPermission,
  requirePlatformAdminAndPermission,
  invalidatePlatformPermissionCache,
} from "../../src/middleware/permission";
import { PLATFORM_PERMISSIONS, PERMISSIONS } from "../../src/lib/permission/permission.constants";
import { platformService } from "../../src/modules/platform/platform.service";
import { sellerService } from "../../src/modules/seller/seller.service";
function mockReqRes(userId: string) {
  const req = { user: { id: userId } } as any;
  const statusCalls: number[] = [];
  const jsonCalls: any[] = [];
  const res = {
    status(code: number) {
      statusCalls.push(code);
      return this;
    },
    json(body: any) {
      jsonCalls.push(body);
      return this;
    },
  } as any;
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  return { req, res, next, statusCalls, jsonCalls, calledNext: () => nextCalled };
}

const TAG = `test_${Date.now()}`;
let roleId: string;
let userId: string;

beforeAll(async () => {
  const role = await db.platformRole.create({
    data: { name: `${TAG}_empty_role`, description: "B1 test role - intentionally has zero permissions" },
  });
  roleId = role.id;

  const user = await db.user.create({
    data: {
      email: `${TAG}@example.invalid`,
      name: "B1 Test User",
      password: "not-a-real-hash",
    },
  });
  userId = user.id;

  await db.platformMember.create({
    data: { userId: user.id, roleId: role.id },
  });
});

afterAll(async () => {
  await db.platformRolePermission.deleteMany({ where: { roleId } });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.platformRole.delete({ where: { id: roleId } });
  await db.user.delete({ where: { id: userId } });
  await invalidatePlatformPermissionCache(userId);
});

describe("requirePlatformPermission - B1 default-deny", () => {
  test("a freshly-created PlatformRole with zero permission rows is denied every platform.* permission checked", async () => {
    for (const key of Object.values(PLATFORM_PERMISSIONS)) {
      const { req, res, next, statusCalls, calledNext } = mockReqRes(userId);
      await requirePlatformPermission(key)(req, res, next);
      expect(calledNext()).toBe(false);
      expect(statusCalls).toEqual([403]);
    }
  });

  test("an empty role is also denied a permission key that doesn't even exist in the catalog", async () => {
    const { req, res, next, statusCalls, calledNext } = mockReqRes(userId);
    await requirePlatformPermission("platform.made.up.key")(req, res, next);
    expect(calledNext()).toBe(false);
    expect(statusCalls).toEqual([403]);
  });

  test("an unauthenticated request (no req.user) is rejected with 401, not 403", async () => {
    const { res, next, statusCalls, calledNext } = mockReqRes(userId);
    const req = {} as any;
    await requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_SELLERS_APPROVE)(req, res, next);
    expect(calledNext()).toBe(false);
    expect(statusCalls).toEqual([401]);
  });

  test("granting exactly one permission allows that key and only that key - proves the check discriminates, not just always-403", async () => {
    const permission = await db.permission.upsert({
      where: { key: PLATFORM_PERMISSIONS.PLATFORM_SELLERS_APPROVE },
      update: {},
      create: { key: PLATFORM_PERMISSIONS.PLATFORM_SELLERS_APPROVE },
    });
    await db.platformRolePermission.create({
      data: { roleId, permissionId: permission.id },
    });
    await invalidatePlatformPermissionCache(userId);

    const granted = mockReqRes(userId);
    await requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_SELLERS_APPROVE)(
      granted.req,
      granted.res,
      granted.next,
    );
    expect(granted.calledNext()).toBe(true);
    expect(granted.statusCalls).toEqual([]);

    const stillDenied = mockReqRes(userId);
    await requirePlatformPermission(PLATFORM_PERMISSIONS.PLATFORM_SELLERS_REJECT)(
      stillDenied.req,
      stillDenied.res,
      stillDenied.next,
    );
    expect(stillDenied.calledNext()).toBe(false);
    expect(stillDenied.statusCalls).toEqual([403]);
  });
});

describe("requirePlatformAdminAndPermission - B2 AND-gated dual-run", () => {
  const LEGACY_ROLE_NAME = `${TAG}_legacy_admin`;
  let legacyRoleId: string;
  let legacyUserId: string;
  let grantedPermissionKey: string;
  let grantedPermissionId: string;

  beforeAll(async () => {
    const role = await db.platformRole.create({
      data: { name: LEGACY_ROLE_NAME, description: "B2 test role" },
    });
    legacyRoleId = role.id;

    const user = await db.user.create({
      data: {
        email: `${TAG}_b2@example.invalid`,
        name: "B2 Test User",
        password: "not-a-real-hash",
      },
    });
    legacyUserId = user.id;

    await db.platformMember.create({
      data: { userId: user.id, roleId: role.id },
    });

    grantedPermissionKey = PLATFORM_PERMISSIONS.PLATFORM_SELLERS_SUSPEND;
    const permission = await db.permission.upsert({
      where: { key: grantedPermissionKey },
      update: {},
      create: { key: grantedPermissionKey },
    });
    grantedPermissionId = permission.id;
  });

  afterAll(async () => {
    await db.platformRolePermission.deleteMany({ where: { roleId: legacyRoleId } });
    await db.platformMember.deleteMany({ where: { userId: legacyUserId } });
    await db.platformRole.delete({ where: { id: legacyRoleId } });
    await db.user.delete({ where: { id: legacyUserId } });
    await invalidatePlatformPermissionCache(legacyUserId);
  });

  test("both checks pass -> next() is called", async () => {
    await db.platformRolePermission.upsert({
      where: { roleId_permissionId: { roleId: legacyRoleId, permissionId: grantedPermissionId } },
      update: {},
      create: { roleId: legacyRoleId, permissionId: grantedPermissionId },
    });
    await invalidatePlatformPermissionCache(legacyUserId);

    const { req, res, next, statusCalls, calledNext } = mockReqRes(legacyUserId);
    await requirePlatformAdminAndPermission([LEGACY_ROLE_NAME], [grantedPermissionKey])(req, res, next);
    expect(calledNext()).toBe(true);
    expect(statusCalls).toEqual([]);
  });

  test("legacy role matches but the new permission is NOT granted -> denied, not allowed via legacy-only", async () => {
    await db.platformRolePermission.deleteMany({ where: { roleId: legacyRoleId } });
    await invalidatePlatformPermissionCache(legacyUserId);

    const { req, res, next, statusCalls, calledNext } = mockReqRes(legacyUserId);
    // legacy role name matches (would pass alone), but requiring an
    // unrelated key that was never granted means the permission check fails
    await requirePlatformAdminAndPermission(
      [LEGACY_ROLE_NAME],
      [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE],
    )(req, res, next);
    expect(calledNext()).toBe(false);
    expect(statusCalls).toEqual([403]);
  });

  test("new permission is granted but the legacy role name doesn't match -> denied, not allowed via permission-only", async () => {
    await db.platformRolePermission.upsert({
      where: { roleId_permissionId: { roleId: legacyRoleId, permissionId: grantedPermissionId } },
      update: {},
      create: { roleId: legacyRoleId, permissionId: grantedPermissionId },
    });
    await invalidatePlatformPermissionCache(legacyUserId);

    const { req, res, next, statusCalls, calledNext } = mockReqRes(legacyUserId);
    // permission is granted (would pass alone), but requiring a role name
    // this user's role doesn't have means the legacy check fails
    await requirePlatformAdminAndPermission(["some_other_role_name"], [grantedPermissionKey])(
      req,
      res,
      next,
    );
    expect(calledNext()).toBe(false);
    expect(statusCalls).toEqual([403]);
  });

  test("neither check passes -> denied", async () => {
    await db.platformRolePermission.deleteMany({ where: { roleId: legacyRoleId } });
    await invalidatePlatformPermissionCache(legacyUserId);

    const { req, res, next, statusCalls, calledNext } = mockReqRes(legacyUserId);
    await requirePlatformAdminAndPermission(
      ["some_other_role_name"],
      [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE],
    )(req, res, next);
    expect(calledNext()).toBe(false);
    expect(statusCalls).toEqual([403]);
  });
});

describe("Seller-side actors cannot reach or influence platform RBAC", () => {
  const SELLER_ROLE_NAME = `${TAG}_seller_owner_role`;
  let sellerId: string;
  let sellerRoleId: string;
  let sellerOnlyUserId: string;

  beforeAll(async () => {
    const seller = await db.seller.create({
      data: {
        name: "B_neg Test Seller",
        email: `${TAG}_seller@example.invalid`,
        phone: "9999999999",
        businessName: "B_neg Test Business",
        businessType: "INDIVIDUAL",
        street: "1 Test St",
        city: "Test City",
        state: "Test State",
        pincode: "000000",
        status: "APPROVED",
      },
    });
    sellerId = seller.id;

    const role = await db.sellerRole.create({
      data: { sellerId, name: SELLER_ROLE_NAME, description: "negative-test role" },
    });
    sellerRoleId = role.id;

    const user = await db.user.create({
      data: {
        email: `${TAG}_selleronly@example.invalid`,
        name: "Seller-only Test User",
        password: "not-a-real-hash",
      },
    });
    sellerOnlyUserId = user.id;

    await db.sellerMember.create({
      data: { userId: user.id, sellerId, roleId: sellerRoleId },
    });
    // deliberately: no db.platformMember.create() for this user
  });

  afterAll(async () => {
    await db.rolePermission.deleteMany({ where: { roleId: sellerRoleId } });
    await db.sellerMember.deleteMany({ where: { userId: sellerOnlyUserId } });
    await db.sellerRole.delete({ where: { id: sellerRoleId } });
    await db.seller.delete({ where: { id: sellerId } });
    await db.user.delete({ where: { id: sellerOnlyUserId } });
    await invalidatePlatformPermissionCache(sellerOnlyUserId);
  });

  test("a seller-side user with no PlatformMember row is denied the platform role-permissions endpoint outright", async () => {
    const { req, res, next, statusCalls, calledNext } = mockReqRes(sellerOnlyUserId);
    await requirePlatformAdminAndPermission(
      ["super_admin"],
      [PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE],
    )(req, res, next);
    expect(calledNext()).toBe(false);
    expect(statusCalls).toEqual([403]);
  });

  test("platformService.updateRolePermissions rejects a non-platform-scoped key even for a real platform role", async () => {
    const role = await db.platformRole.create({
      data: { name: `${TAG}_neg_platform_role`, description: "negative-test platform role" },
    });
    try {
      await expect(
        platformService.updateRolePermissions("test-actor", role.id, [PERMISSIONS.PRODUCTS_CREATE]),
      ).rejects.toThrow(/Not platform-scoped permissions/);
    } finally {
      await db.platformRole.delete({ where: { id: role.id } });
    }
  });

  test("a seller cannot self-grant a platform.* permission via the real seller-side updateRolePermissions", async () => {
    await expect(
      sellerService.updateRolePermissions(sellerId, sellerOnlyUserId, sellerRoleId, [
        PLATFORM_PERMISSIONS.PLATFORM_ADMIN_ROLES_MANAGE,
      ]),
    ).rejects.toThrow(/Not seller-scoped permissions/);
  });
});

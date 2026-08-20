import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../../src/db/index";
import { redis } from "../../src/db/redis";
import { jwtService } from "../../src/utils/jwt";
import { protect } from "../../src/middleware/auth";
import {
  requireCustomerOrgPermission,
  requireCustomerOrgPermissionIfOrg,
} from "../../src/middleware/permission";
import { customerOrgService } from "../../src/modules/customer-org/customer-org.service";
import { cartService } from "../../src/modules/cart/cart.service";
import { orderService } from "../../src/modules/order/order.service";
import { autoNegotiationService } from "../../src/modules/negotiation/auto-negotiation.service";
import { customerService } from "../../src/modules/customer/customer.service";
import { myNegotiationService } from "../../src/modules/negotiation/my-negotiation.service";
import { CUSTOMER_ORG_PERMISSIONS } from "../../src/lib/permission/customer-org-permission.constants";
import { verifyOrderAccess } from "../../src/middleware/order-access";

const TAG = `test_corg_${Date.now()}`;

const address = {
  receiverName: "Org Receiver",
  phone: "9999999999",
  street: "1 Org St",
  city: "Org City",
  state: "Org State",
  pincode: "000000",
};

let categoryId: string;
let sellerId: string;
let productId: string;
let skuId: string;
let negotiableSkuId: string;
let negotiableProductId: string;

// Users
let founderId: string;
let memberId: string;
let outsiderId: string;
let existingInviteeId: string;

let orgAId: string;
let orgARoleAdminId: string;
let orgALimitedRoleId: string;
let orgAMemberRowId: string;
let orgBId: string;

const NEGOTIABLE_QTY = 2;

function mockReqRes(opts: {
  userId?: string;
  customerOrg?: any;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  user?: any;
}) {
  const req: any = {
    user: opts.user ?? (opts.userId ? { id: opts.userId } : undefined),
    customerOrg: opts.customerOrg,
    headers: opts.headers ?? {},
    params: opts.params ?? {},
    originalUrl: "/test",
    method: "GET",
    ip: "127.0.0.1",
    get: () => undefined,
  };
  const statusCalls: number[] = [];
  const jsonCalls: any[] = [];
  const res: any = {
    status(code: number) {
      statusCalls.push(code);
      return this;
    },
    json(body: any) {
      jsonCalls.push(body);
      return this;
    },
  };
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  return { req, res, next, statusCalls, jsonCalls, calledNext: () => nextCalled };
}

async function runProtect(userId: string, email: string, activeOrgId?: string) {
  const { accessToken } = jwtService.signTokens({ sub: userId, email, role: "user" } as any);
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  if (activeOrgId !== undefined) headers["x-active-org-id"] = activeOrgId;
  const ctx = mockReqRes({ headers });
  await protect(ctx.req, ctx.res, ctx.next);
  return ctx;
}

async function createUser(label: string) {
  const user = await db.user.create({
    data: {
      email: `${TAG}_${label}@example.invalid`,
      name: `Org Test ${label}`,
      password: "not-a-real-hash",
    },
  });
  return user.id;
}

beforeAll(async () => {
  const category = await db.category.create({
    data: { name: `${TAG}_category`, slug: `${TAG}-category` },
  });
  categoryId = category.id;

  const seller = await db.seller.create({
    data: {
      name: "Org Test Seller",
      email: `${TAG}_seller@example.invalid`,
      phone: "9876500000",
      businessName: "Org Test Business",
      businessType: "INDIVIDUAL",
      street: "1 Seller St",
      city: "Seller City",
      state: "Seller State",
      pincode: "111111",
      status: "APPROVED",
    },
  });
  sellerId = seller.id;

  const product = await db.product.create({
    data: { sellerId, categoryId, name: "Org Test Product", price: 500, status: "LIVE" },
  });
  productId = product.id;
  const sku = await db.productSKU.create({
    data: { productId, sku: `${TAG}-SKU`, price: 500, stock: 1000, options: {} },
  });
  skuId = sku.id;

  const negotiableProduct = await db.product.create({
    data: { sellerId, categoryId, name: "Org Negotiable Product", price: 1000, status: "LIVE" },
  });
  negotiableProductId = negotiableProduct.id;
  const negotiableSku = await db.productSKU.create({
    data: { productId: negotiableProductId, sku: `${TAG}-NEG-SKU`, price: 1000, stock: 1000, options: {} },
  });
  negotiableSkuId = negotiableSku.id;
  await db.skuPriceTier.create({
    data: { skuId: negotiableSkuId, minQty: NEGOTIABLE_QTY, price: 1000, hiddenFloorPrice: 500 },
  });

  founderId = await createUser("founder");
  memberId = await createUser("member");
  outsiderId = await createUser("outsider");
  existingInviteeId = await createUser("existing_invitee");

  const orgA = await customerOrgService.createOrg(founderId, { name: `${TAG} Org A` });
  orgAId = orgA.id;
  orgARoleAdminId = orgA.role.id;

  const orgBCreatorId = await createUser("orgb_creator");
  const orgB = await customerOrgService.createOrg(orgBCreatorId, { name: `${TAG} Org B` });
  orgBId = orgB.id;
  await db.customerOrgMember.create({
    data: { userId: founderId, orgId: orgBId, roleId: orgB.role.id },
  });

  const limited = await customerOrgService.createRole(orgAId, founderId, {
    name: "buyer_no_checkout",
    permissions: [
      CUSTOMER_ORG_PERMISSIONS.VIEW_ORG_CART,
      CUSTOMER_ORG_PERMISSIONS.EDIT_ORG_CART,
      CUSTOMER_ORG_PERMISSIONS.VIEW_ORDER_HISTORY,
    ],
  });
  orgALimitedRoleId = limited.id;

  const memberRow = await db.customerOrgMember.create({
    data: { userId: memberId, orgId: orgAId, roleId: orgALimitedRoleId },
  });
  orgAMemberRowId = memberRow.id;
  await redis.del(`customer-orgs:${memberId}`);
});

afterAll(async () => {
  const userIds = [founderId, memberId, outsiderId, existingInviteeId].filter(Boolean);

  const newUsers = await db.user.findMany({
    where: { email: { startsWith: TAG } },
    select: { id: true },
  });
  const allUserIds = [...new Set([...userIds, ...newUsers.map((u) => u.id)])];

  const createdOrgs = await db.customerOrg.findMany({
    where: { createdBy: { in: allUserIds } },
    select: { id: true },
  });
  const orgIds = [...new Set([orgAId, orgBId, ...createdOrgs.map((o) => o.id)].filter(Boolean))];

  const orders = await db.order.findMany({ where: { sellerId }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await db.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { sellerId } });

  await db.negotiationRound.deleteMany({
    where: { session: { skuId: { in: [skuId, negotiableSkuId] } } },
  });
  await db.negotiationChatSession.deleteMany({
    where: { session: { skuId: { in: [skuId, negotiableSkuId] } } },
  });
  await db.negotiationSession.deleteMany({ where: { skuId: { in: [skuId, negotiableSkuId] } } });

  const carts = await db.cart.findMany({
    where: { userId: { in: allUserIds } },
    select: { id: true },
  });
  await db.cartItem.deleteMany({ where: { cartId: { in: carts.map((c) => c.id) } } });
  await db.cart.deleteMany({ where: { userId: { in: allUserIds } } });

  await db.customerOrgInvite.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.customerOrgMember.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.customerOrgRolePermission.deleteMany({ where: { role: { orgId: { in: orgIds } } } });
  await db.customerOrgRole.deleteMany({ where: { orgId: { in: orgIds } } });
  await db.customerOrg.deleteMany({ where: { id: { in: orgIds } } });

  await db.auditLog.deleteMany({ where: { actorId: { in: allUserIds } } });
  await db.notificationDelivery.deleteMany({
    where: { notification: { userId: { in: allUserIds } } },
  });
  await db.notification.deleteMany({ where: { userId: { in: allUserIds } } });

  await db.skuPriceTier.deleteMany({ where: { skuId: negotiableSkuId } });
  await db.productSKU.deleteMany({ where: { productId: { in: [productId, negotiableProductId] } } });
  await db.product.deleteMany({ where: { id: { in: [productId, negotiableProductId] } } });
  await db.seller.deleteMany({ where: { id: sellerId } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: { in: allUserIds } } });

  const keys = allUserIds.flatMap((id) => [`customer-orgs:${id}`, `authctx:${id}`]);
  if (keys.length) await redis.del(...keys);
});

describe("org creation, roles and invites", () => {
  test("creating an org makes the creator its first member with a full-permissions admin role", async () => {
    const roles = await customerOrgService.listRoles(orgAId);
    const admin = roles.find((r) => r.id === orgARoleAdminId);

    expect(admin).toBeDefined();
    expect(admin!.name).toBe("admin");
    expect(admin!.isDefault).toBe(true);
    // All 8 catalog permissions.
    expect(admin!.permissions.sort()).toEqual(
      Object.values(CUSTOMER_ORG_PERMISSIONS).sort(),
    );

    const member = await db.customerOrgMember.findUnique({
      where: { userId_orgId: { userId: founderId, orgId: orgAId } },
    });
    expect(member).not.toBeNull();
    expect(member!.roleId).toBe(orgARoleAdminId);
    expect(member!.isActive).toBe(true);
  });

  test("a user who already created an org cannot create a second one", async () => {
    // `founder` already created orgA in beforeAll.
    await expect(
      customerOrgService.createOrg(founderId, { name: `${TAG} Org C` }),
    ).rejects.toThrow("You can only create one organization");
  });

  test("the creation cap is race-safe: concurrent creates from the same new user leave exactly one org", async () => {
    const racerId = await createUser("racer");
    const results = await Promise.allSettled([
      customerOrgService.createOrg(racerId, { name: `${TAG} Racer Org 1` }),
      customerOrgService.createOrg(racerId, { name: `${TAG} Racer Org 2` }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain(
      "You can only create one organization",
    );

    const count = await db.customerOrg.count({ where: { createdBy: racerId } });
    expect(count).toBe(1);
  });

  test("membership in other orgs via invite is unaffected by the creation cap", async () => {
    const orgs = await customerOrgService.listMyOrgs(founderId);
    expect(orgs.map((o) => o.orgId).sort()).toEqual([orgAId, orgBId].sort());
    expect(orgs.find((o) => o.orgId === orgAId)?.createdByMe).toBe(true);
    expect(orgs.find((o) => o.orgId === orgBId)?.createdByMe).toBe(false);
  });

  test("invite -> accept creates a CustomerOrgMember with the invited role (NEW user path)", async () => {
    const email = `${TAG}_brandnew@example.invalid`;
    const invite = await customerOrgService.inviteMember(orgAId, founderId, {
      email,
      roleId: orgALimitedRoleId,
    });
    expect(invite.status).toBe("PENDING");

    const row = await db.customerOrgInvite.findUnique({ where: { id: invite.id } });
    // No such user existed before accepting.
    expect(await db.user.findUnique({ where: { email } })).toBeNull();

    const result = await customerOrgService.acceptInvite(row!.token, {
      name: "Brand New",
      password: "supersecret123",
    });

    expect(result.user.email).toBe(email);
    const created = await db.user.findUnique({ where: { email } });
    expect(created).not.toBeNull();
    expect(created!.password).not.toBe("supersecret123"); // hashed, not stored raw

    const membership = await db.customerOrgMember.findUnique({
      where: { userId_orgId: { userId: created!.id, orgId: orgAId } },
    });
    expect(membership).not.toBeNull();
    expect(membership!.roleId).toBe(orgALimitedRoleId);

    const after = await db.customerOrgInvite.findUnique({ where: { id: invite.id } });
    expect(after!.status).toBe("ACCEPTED");
  });

  test("invite -> accept attaches an EXISTING user without creating a duplicate", async () => {
    const email = `${TAG}_existing_invitee@example.invalid`;
    const usersBefore = await db.user.count({ where: { email } });
    expect(usersBefore).toBe(1);

    const invite = await customerOrgService.inviteMember(orgBId, founderId, {
      email,
      roleId: (await db.customerOrgRole.findFirstOrThrow({ where: { orgId: orgBId } })).id,
    });
    const row = await db.customerOrgInvite.findUnique({ where: { id: invite.id } });

    const result = await customerOrgService.acceptInvite(row!.token, {
      name: "Ignored For Existing User",
      password: "anotherpassword123",
    });

    expect(result.user.id).toBe(existingInviteeId);
    expect(await db.user.count({ where: { email } })).toBe(1);

    const membership = await db.customerOrgMember.findUnique({
      where: { userId_orgId: { userId: existingInviteeId, orgId: orgBId } },
    });
    expect(membership).not.toBeNull();
  });

  test("an expired invite cannot be accepted", async () => {
    const invite = await customerOrgService.inviteMember(orgAId, founderId, {
      email: `${TAG}_expired@example.invalid`,
      roleId: orgALimitedRoleId,
    });
    await db.customerOrgInvite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const row = await db.customerOrgInvite.findUnique({ where: { id: invite.id } });

    await expect(
      customerOrgService.acceptInvite(row!.token, { name: "Nope", password: "password1234" }),
    ).rejects.toThrow("Invite expired");
  });
});

describe("permission enforcement", () => {
  test("member lacking place_order is blocked from checkout even though they can see the cart", async () => {
    const orgCtx = { memberId: orgAMemberRowId, orgId: orgAId, orgName: "A", roleId: orgALimitedRoleId, roleName: "buyer_no_checkout" };

    const viewCtx = mockReqRes({ userId: memberId, customerOrg: orgCtx });
    await requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.VIEW_ORG_CART)(
      viewCtx.req,
      viewCtx.res,
      viewCtx.next,
    );
    expect(viewCtx.calledNext()).toBe(true);

   const checkoutCtx = mockReqRes({ userId: memberId, customerOrg: orgCtx });
    await requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.PLACE_ORDER)(
      checkoutCtx.req,
      checkoutCtx.res,
      checkoutCtx.next,
    );
    expect(checkoutCtx.calledNext()).toBe(false);
    expect(checkoutCtx.statusCalls).toContain(403);
  });

  test("member lacking manage_roles cannot create or edit roles", async () => {
    const orgCtx = { memberId: orgAMemberRowId, orgId: orgAId, orgName: "A", roleId: orgALimitedRoleId, roleName: "buyer_no_checkout" };
    const ctx = mockReqRes({ userId: memberId, customerOrg: orgCtx });
    await requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES)(
      ctx.req,
      ctx.res,
      ctx.next,
    );
    expect(ctx.calledNext()).toBe(false);
    expect(ctx.statusCalls).toContain(403);

    const adminCtx = mockReqRes({
      userId: founderId,
      customerOrg: { memberId: "x", orgId: orgAId, orgName: "A", roleId: orgARoleAdminId, roleName: "admin" },
    });
    await requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES)(
      adminCtx.req,
      adminCtx.res,
      adminCtx.next,
    );
    expect(adminCtx.calledNext()).toBe(true);
  });

  test("requireCustomerOrgPermission refuses requests with no active org", async () => {
    const ctx = mockReqRes({ userId: outsiderId });
    await requireCustomerOrgPermission(CUSTOMER_ORG_PERMISSIONS.MANAGE_ROLES)(
      ctx.req,
      ctx.res,
      ctx.next,
    );
    expect(ctx.calledNext()).toBe(false);
    expect(ctx.statusCalls).toContain(403);
    expect(ctx.jsonCalls[0].code).toBe("NO_ACTIVE_ORG");
  });

  test("requireCustomerOrgPermissionIfOrg is a no-op for individual customers", async () => {
    const ctx = mockReqRes({ userId: outsiderId });
    await requireCustomerOrgPermissionIfOrg(CUSTOMER_ORG_PERMISSIONS.PLACE_ORDER)(
      ctx.req,
      ctx.res,
      ctx.next,
    );
    expect(ctx.calledNext()).toBe(true);
    expect(ctx.statusCalls).toHaveLength(0);
  });
});

describe("active-org resolution via X-Active-Org-Id", () => {
  test("no header defaults to the user's first membership", async () => {
    const ctx = await runProtect(founderId, `${TAG}_founder@example.invalid`);
    expect(ctx.calledNext()).toBe(true);
    expect(ctx.req.customerOrg?.orgId).toBe(orgAId);
    expect(ctx.req.user.customerOrgMemberships).toHaveLength(2);
  });

  test("header selects the requested org when the user is a member", async () => {
    const ctx = await runProtect(founderId, `${TAG}_founder@example.invalid`, orgBId);
    expect(ctx.calledNext()).toBe(true);
    expect(ctx.req.customerOrg?.orgId).toBe(orgBId);
  });

  test("an org id the user does NOT belong to is rejected, not trusted", async () => {
    // memberId belongs to OrgA only. Ask for OrgB.
    const ctx = await runProtect(memberId, `${TAG}_member@example.invalid`, orgBId);
    expect(ctx.calledNext()).toBe(false);
    expect(ctx.statusCalls).toContain(403);
    expect(ctx.jsonCalls[0].code).toBe("INVALID_ACTIVE_ORG");
    // Discriminating check: it must NOT have silently fallen back to OrgA either.
    expect(ctx.req.customerOrg).toBeUndefined();
  });

  test("a wholly unknown org id is rejected too", async () => {
    const ctx = await runProtect(founderId, `${TAG}_founder@example.invalid`, "org_does_not_exist");
    expect(ctx.calledNext()).toBe(false);
    expect(ctx.statusCalls).toContain(403);
    expect(ctx.req.customerOrg).toBeUndefined();
  });

  test("a user with no memberships gets no org context at all", async () => {
    const ctx = await runProtect(outsiderId, `${TAG}_outsider@example.invalid`);
    expect(ctx.calledNext()).toBe(true);
    expect(ctx.req.customerOrg).toBeUndefined();
    expect(ctx.req.user.customerOrgMemberships).toEqual([]);
  });

  test("listMyOrgs returns every org the user can switch to", async () => {
    const orgs = await customerOrgService.listMyOrgs(founderId);
    expect(orgs.map((o) => o.orgId).sort()).toEqual([orgAId, orgBId].sort());
  });
});

describe("shared org cart vs independent personal carts", () => {
  test("two members of the same org see the same org cart, and each keeps a separate personal cart", async () => {
    // Founder adds to the ORG A cart.
    await cartService.addItem(founderId, { productId, skuId, quantity: 3 }, orgAId);

    // The other OrgA member sees the same shared cart and the same item.
    const memberOrgView = await cartService.getCart(memberId, orgAId);
    expect(memberOrgView.items).toHaveLength(1);
    expect(memberOrgView.items[0].quantity).toBe(3);

    const founderOrgView = await cartService.getCart(founderId, orgAId);
    expect(founderOrgView.cart.id).toBe(memberOrgView.cart.id);
    expect(founderOrgView.cart.orgId).toBe(orgAId);

    // Each member's PERSONAL cart is a different row and is untouched.
    const founderPersonal = await cartService.getCart(founderId);
    const memberPersonal = await cartService.getCart(memberId);
    expect(founderPersonal.cart.id).not.toBe(memberOrgView.cart.id);
    expect(memberPersonal.cart.id).not.toBe(memberOrgView.cart.id);
    expect(founderPersonal.cart.id).not.toBe(memberPersonal.cart.id);
    expect(founderPersonal.cart.orgId).toBeNull();
    expect(memberPersonal.cart.orgId).toBeNull();
    expect(founderPersonal.items).toHaveLength(0);
    expect(memberPersonal.items).toHaveLength(0);

    // A personal add must not leak into the org cart.
    await cartService.addItem(founderId, { productId, skuId, quantity: 1 });
    const orgAfterPersonalAdd = await cartService.getCart(memberId, orgAId);
    expect(orgAfterPersonalAdd.items[0].quantity).toBe(3);
    const personalAfter = await cartService.getCart(founderId);
    expect(personalAfter.items[0].quantity).toBe(1);
  });

  test("the same user's two org carts are independent of each other", async () => {
    await cartService.addItem(founderId, { productId, skuId, quantity: 7 }, orgBId);
    const a = await cartService.getCart(founderId, orgAId);
    const b = await cartService.getCart(founderId, orgBId);
    expect(a.cart.id).not.toBe(b.cart.id);
    expect(a.items[0].quantity).toBe(3);
    expect(b.items[0].quantity).toBe(7);
  });

  test("clearing an org cart leaves the personal cart intact", async () => {
    await cartService.clearCart(founderId, orgBId);
    const b = await cartService.getCart(founderId, orgBId);
    expect(b.items).toHaveLength(0);
    const personal = await cartService.getCart(founderId);
    expect(personal.items).toHaveLength(1);
  });

  test("only one personal cart row can exist per user (partial unique index holds)", async () => {
    let err: any;
    try {
      await db.cart.create({ data: { userId: founderId, orgId: null } });
    } catch (e: any) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe("P2002");
  });

  test("only one cart row can exist per org (shared-cart partial unique index holds)", async () => {
    let err: any;
    try {
      await db.cart.create({ data: { userId: memberId, orgId: orgAId } });
    } catch (e: any) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe("P2002");
  });
});

describe("orders record both orgId and the acting member", () => {
  test("org checkout stamps orgId and the acting member's customerId", async () => {
    const order = await orderService.createOrder(memberId, `${TAG}-order-1`, {
      sellerId,
      type: "STANDARD",
      items: [{ productId, quantity: 1, skuId }],
      deliveryAddress: address,
      orgId: orgAId,
    });

    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.orgId).toBe(orgAId);
    expect(row.customerId).toBe(memberId); // who actually placed it
  });

  test("a personal order has orgId NULL", async () => {
    const order = await orderService.createOrder(outsiderId, `${TAG}-order-personal`, {
      sellerId,
      type: "STANDARD",
      items: [{ productId, quantity: 1, skuId }],
      deliveryAddress: address,
    });
    const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.orgId).toBeNull();
    expect(row.customerId).toBe(outsiderId);
  });

  test("another org member can read an order they did not place", async () => {
    const order = await orderService.createOrder(memberId, `${TAG}-order-2`, {
      sellerId,
      type: "STANDARD",
      items: [{ productId, quantity: 1, skuId }],
      deliveryAddress: address,
      orgId: orgAId,
    });

    // Founder never placed it, but is an OrgA member with view_order_history.
    const asFounder = await orderService.getOrder(order.id, founderId);
    expect(asFounder.id).toBe(order.id);

    // An outsider still cannot.
    await expect(orderService.getOrder(order.id, outsiderId)).rejects.toThrow("Order not found");
  });

  test("verifyOrderAccess admits an org member and rejects an outsider", async () => {
    const order = await orderService.createOrder(founderId, `${TAG}-order-3`, {
      sellerId,
      type: "STANDARD",
      items: [{ productId, quantity: 1, skuId }],
      deliveryAddress: address,
      orgId: orgAId,
    });

    const memberCtx = mockReqRes({ userId: memberId, params: { orderId: order.id } });
    await verifyOrderAccess(memberCtx.req, memberCtx.res, memberCtx.next);
    expect(memberCtx.calledNext()).toBe(true);

    const outsiderCtx = mockReqRes({ userId: outsiderId, params: { orderId: order.id } });
    await verifyOrderAccess(outsiderCtx.req, outsiderCtx.res, outsiderCtx.next);
    expect(outsiderCtx.calledNext()).toBe(false);
    expect(outsiderCtx.statusCalls).toContain(404);
  });

  test("order history is org-shared under an org and personal-only otherwise", async () => {
    const orgHistory = await customerService.listMyOrders(founderId, {}, orgAId);
    // Includes orders placed by `member`, not just by `founder`.
    expect(orgHistory.data.some((o: any) => o.customerId === memberId)).toBe(true);
    expect(orgHistory.data.every((o: any) => o.orgId === orgAId)).toBe(true);

    // Personal listing excludes org orders entirely.
    const personalHistory = await customerService.listMyOrders(memberId, {});
    expect(personalHistory.data.every((o: any) => o.orgId === null)).toBe(true);
  });
});

describe("negotiations record both orgId and the acting member", () => {
  test("org negotiation stamps orgId, and another member can read/act on it", async () => {
    const { session } = await autoNegotiationService.startSession(
      memberId,
      sellerId,
      negotiableProductId,
      negotiableSkuId,
      NEGOTIABLE_QTY,
      undefined,
      orgAId,
    );

    const row = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.orgId).toBe(orgAId);
    expect(row.customerId).toBe(memberId);

    // Founder didn't start it but is an OrgA member with manage_negotiations.
    const asFounder = await autoNegotiationService.getSession(founderId, session.id);
    expect(asFounder.id).toBe(session.id);

    // An outsider cannot.
    await expect(autoNegotiationService.getSession(outsiderId, session.id)).rejects.toThrow(
      "Negotiation session not found",
    );
  });

  test("a personal negotiation is invisible to org members and has orgId NULL", async () => {
    const { session } = await autoNegotiationService.startSession(
      outsiderId,
      sellerId,
      negotiableProductId,
      negotiableSkuId,
      NEGOTIABLE_QTY,
    );
    const row = await db.negotiationSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.orgId).toBeNull();

    await expect(autoNegotiationService.getSession(founderId, session.id)).rejects.toThrow(
      "Negotiation session not found",
    );
  });

  test("negotiation history is org-shared under an org and personal-only otherwise", async () => {
    const orgList = await myNegotiationService.listSessions(founderId, "customer", {}, orgAId);
    expect(orgList.data.length).toBeGreaterThan(0);
    expect(orgList.data.every((s: any) => s.orgId === orgAId)).toBe(true);
    expect(orgList.data.some((s: any) => s.customerId === memberId)).toBe(true);

    const personalList = await myNegotiationService.listSessions(outsiderId, "customer", {});
    expect(personalList.data.every((s: any) => s.orgId === null)).toBe(true);
  });

  test("the acting member's own open session still blocks them, org or not", async () => {
    await expect(
      autoNegotiationService.startSession(
        memberId,
        sellerId,
        negotiableProductId,
        negotiableSkuId,
        NEGOTIABLE_QTY,
      ),
    ).rejects.toThrow("A negotiation session is already open");

    const rows = await db.negotiationSession.count({
      where: { customerId: memberId, skuId: negotiableSkuId },
    });
    expect(rows).toBe(1);
  });

  test("an org's open session DOES block another member of the same org", async () => {
    await expect(
      autoNegotiationService.startSession(
        founderId,
        sellerId,
        negotiableProductId,
        negotiableSkuId,
        NEGOTIABLE_QTY,
        undefined,
        orgAId,
      ),
    ).rejects.toThrow("A negotiation session is already open");
  });
});

describe("idempotency under org context", () => {
  test("two org members racing the SAME idempotency key produce exactly one order", async () => {
    const key = `${TAG}-race-shared`;
    const input = {
      sellerId,
      type: "STANDARD" as const,
      items: [{ productId, quantity: 1, skuId }],
      deliveryAddress: address,
      orgId: orgAId,
    };

    const results = await Promise.allSettled([
      orderService.createOrder(founderId, key, input),
      orderService.createOrder(memberId, key, input),
    ]);

    const created = await db.order.findMany({
      where: { orgId: orgAId, sellerId },
      select: { id: true },
    });

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    if (rejected.length) {
      expect(rejected[0].reason.message).toContain("Duplicate order submission detected");
      expect(fulfilled).toHaveLength(1);
    } else {
      expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);
    }

    const idemOrderId = await redis.get(`order:idem:org:${orgAId}:${key}`);
    expect(idemOrderId).toBeTruthy();
    expect(created.map((c) => c.id)).toContain(idemOrderId!);
  });

  test("two org members with DIFFERENT idempotency keys both succeed (no false blocking)", async () => {
    const input = {
      sellerId,
      type: "STANDARD" as const,
      items: [{ productId, quantity: 1, skuId }],
      deliveryAddress: address,
      orgId: orgAId,
    };

    const [a, b] = await Promise.all([
      orderService.createOrder(founderId, `${TAG}-sep-a`, input),
      orderService.createOrder(memberId, `${TAG}-sep-b`, input),
    ]);

    expect(a.id).not.toBe(b.id);
    const rowA = await db.order.findUniqueOrThrow({ where: { id: a.id } });
    const rowB = await db.order.findUniqueOrThrow({ where: { id: b.id } });
    expect(rowA.customerId).toBe(founderId);
    expect(rowB.customerId).toBe(memberId);
    expect(rowA.orgId).toBe(orgAId);
    expect(rowB.orgId).toBe(orgAId);
  });

  test("an org idempotency key does not collide with a personal one of the same value", async () => {
    const key = `${TAG}-scope-collision`;
    const base = {
      sellerId,
      type: "STANDARD" as const,
      items: [{ productId, quantity: 1, skuId }],
      deliveryAddress: address,
    };

    const orgOrder = await orderService.createOrder(founderId, key, { ...base, orgId: orgAId });
    const personalOrder = await orderService.createOrder(founderId, key, base);

    expect(orgOrder.id).not.toBe(personalOrder.id);
    // Personal keys keep the pre-existing, un-prefixed shape.
    expect(await redis.get(`order:idem:${founderId}:${key}`)).toBe(personalOrder.id);
    expect(await redis.get(`order:idem:org:${orgAId}:${key}`)).toBe(orgOrder.id);
  });
});

describe("permission catalog immutability", () => {
  test("the catalog contains exactly the 8 platform-defined keys", async () => {
    const catalog = await customerOrgService.listPermissionCatalog();
    expect(catalog.map((c) => c.key).sort()).toEqual(
      Object.values(CUSTOMER_ORG_PERMISSIONS).sort(),
    );
  });

  test("assigning an unknown permission key to a role is rejected, not auto-created", async () => {
    const before = await db.customerOrgPermission.count();

    await expect(
      customerOrgService.createRole(orgAId, founderId, {
        name: "invented_role",
        permissions: ["totally_made_up_permission"],
      }),
    ).rejects.toThrow("Unknown permissions: totally_made_up_permission");

    await expect(
      customerOrgService.updateRolePermissions(orgAId, founderId, orgALimitedRoleId, [
        CUSTOMER_ORG_PERMISSIONS.VIEW_ORG_CART,
        "another_made_up_one",
      ]),
    ).rejects.toThrow("Unknown permissions: another_made_up_one");

    // Discriminating check: the catalog did not grow, and the failed role wasn't created.
    expect(await db.customerOrgPermission.count()).toBe(before);
    expect(
      await db.customerOrgRole.findUnique({
        where: { orgId_name: { orgId: orgAId, name: "invented_role" } },
      }),
    ).toBeNull();
  });

  test("no route on the customer-org router writes to the permission catalog", async () => {
    const routes = (await import("../../src/modules/customer-org/customer-org.routes")).default;
    const layers = (routes as any).stack ?? [];
    const permissionRoutes = layers
      .filter((l: any) => l.route?.path?.includes("permission"))
      .map((l: any) => ({
        path: l.route.path,
        methods: Object.keys(l.route.methods).filter((m) => l.route.methods[m]),
      }));

    const catalogRoutes = permissionRoutes.filter((r: any) => r.path === "/permissions");
    expect(catalogRoutes).toHaveLength(1);
    expect(catalogRoutes[0].methods).toEqual(["get"]);
  });

  test("the default admin role is protected from edits", async () => {
    await expect(
      customerOrgService.updateRolePermissions(orgAId, founderId, orgARoleAdminId, []),
    ).rejects.toThrow("Cannot modify the default admin role");
    await expect(
      customerOrgService.updateRole(orgAId, founderId, orgARoleAdminId, { name: "renamed" }),
    ).rejects.toThrow("Cannot modify the default admin role");
    await expect(
      customerOrgService.deleteRole(orgAId, founderId, orgARoleAdminId),
    ).rejects.toThrow("Cannot modify the default admin role");
  });
});

describe("RLS: DB-level org isolation", () => {
  const RLS_ROLE = `${TAG}_rls`.toLowerCase().replace(/[^a-z0-9_]/g, "_");

  beforeAll(async () => {
    await db.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
          CREATE ROLE ${RLS_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
    await db.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON carts, orders, negotiation_sessions TO ${RLS_ROLE}`,
    );
  });

  afterAll(async () => {
    await db.$executeRawUnsafe(
      `REVOKE ALL ON carts, orders, negotiation_sessions FROM ${RLS_ROLE}`,
    ).catch(() => null);
    await db.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM ${RLS_ROLE}`).catch(() => null);
    await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${RLS_ROLE}`).catch(() => null);
  });

  test("the non-bypassrls role really is subject to RLS (control)", async () => {
    const role = await db.$queryRawUnsafe<any[]>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '${RLS_ROLE}'`,
    );
    expect(role[0].rolsuper).toBe(false);
    expect(role[0].rolbypassrls).toBe(false);

    const forced = await db.$queryRawUnsafe<any[]>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('carts','orders','negotiation_sessions')`,
    );
    expect(forced).toHaveLength(3);
    for (const t of forced) {
      expect(t.relrowsecurity).toBe(true);
      expect(t.relforcerowsecurity).toBe(true);
    }
  });

  test("a direct DB query scoped to OrgA cannot see OrgB's cart, and vice versa", async () => {
    const cartA = await db.cart.findFirstOrThrow({ where: { userId: founderId, orgId: orgAId } });
    const cartB = await db.cart.findFirstOrThrow({ where: { userId: founderId, orgId: orgBId } });

    const visibleUnderA = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_customer_org', '${orgAId}', true)`);
      return tx.$queryRawUnsafe<any[]>(
        `SELECT id FROM carts WHERE id IN ('${cartA.id}', '${cartB.id}')`,
      );
    });
    expect(visibleUnderA.map((r) => r.id)).toEqual([cartA.id]);

    const visibleUnderB = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_customer_org', '${orgBId}', true)`);
      return tx.$queryRawUnsafe<any[]>(
        `SELECT id FROM carts WHERE id IN ('${cartA.id}', '${cartB.id}')`,
      );
    });
    expect(visibleUnderB.map((r) => r.id)).toEqual([cartB.id]);
  });

  test("with no org scope set, org rows are invisible but personal rows remain visible", async () => {
    const orgCart = await db.cart.findFirstOrThrow({ where: { userId: founderId, orgId: orgAId } });
    const personalCart = await db.cart.findFirstOrThrow({
      where: { userId: founderId, orgId: null },
    });

    const visible = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`);
      return tx.$queryRawUnsafe<any[]>(
        `SELECT id FROM carts WHERE id IN ('${orgCart.id}', '${personalCart.id}')`,
      );
    });

    expect(visible.map((r) => r.id)).toEqual([personalCart.id]);
  });

  test("orders and negotiation_sessions are isolated the same way", async () => {
    const orgOrder = await db.order.findFirstOrThrow({ where: { orgId: orgAId } });
    const personalOrder = await db.order.findFirstOrThrow({
      where: { customerId: outsiderId, orgId: null },
    });
    const orgSession = await db.negotiationSession.findFirstOrThrow({ where: { orgId: orgAId } });
    const personalSession = await db.negotiationSession.findFirstOrThrow({
      where: { customerId: outsiderId, orgId: null },
    });

    const seen = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_customer_org', '${orgBId}', true)`);
      const orders = await tx.$queryRawUnsafe<any[]>(
        `SELECT id FROM orders WHERE id IN ('${orgOrder.id}', '${personalOrder.id}')`,
      );
      const sessions = await tx.$queryRawUnsafe<any[]>(
        `SELECT id FROM negotiation_sessions WHERE id IN ('${orgSession.id}', '${personalSession.id}')`,
      );
      return { orders, sessions };
    });

    // Scoped to OrgB: OrgA's org-owned rows are filtered out, personal rows survive.
    expect(seen.orders.map((r) => r.id)).toEqual([personalOrder.id]);
    expect(seen.sessions.map((r) => r.id)).toEqual([personalSession.id]);
  });

  test("an org row cannot be INSERTed under a different org's scope", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${RLS_ROLE}`);
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_customer_org', '${orgBId}', true)`,
        );
        // Claiming OrgA while scoped to OrgB must fail the policy's WITH CHECK.
        return tx.$executeRawUnsafe(
          `INSERT INTO carts (id, "userId", "orgId", "createdAt", "updatedAt")
           VALUES ('${TAG}_rls_bad', '${outsiderId}', '${orgAId}', now(), now())`,
        );
      }),
    ).rejects.toThrow();
  });
});

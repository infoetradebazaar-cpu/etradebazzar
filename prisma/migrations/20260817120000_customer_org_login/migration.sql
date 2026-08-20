-- DropIndex
DROP INDEX "carts_userId_key";

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "negotiation_sessions" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "orgId" TEXT;

-- CreateTable
CREATE TABLE "customer_orgs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_org_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_org_roles" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_org_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_org_permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "customer_org_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_org_role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "customer_org_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_org_invites" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_org_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_org_members_orgId_idx" ON "customer_org_members"("orgId");

-- CreateIndex
CREATE INDEX "customer_org_members_userId_idx" ON "customer_org_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_org_members_userId_orgId_key" ON "customer_org_members"("userId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_org_roles_orgId_name_key" ON "customer_org_roles"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_org_permissions_key_key" ON "customer_org_permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "customer_org_role_permissions_roleId_permissionId_key" ON "customer_org_role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_org_invites_token_key" ON "customer_org_invites"("token");

-- CreateIndex
CREATE INDEX "customer_org_invites_orgId_idx" ON "customer_org_invites"("orgId");

-- CreateIndex
CREATE INDEX "customer_org_invites_token_idx" ON "customer_org_invites"("token");

-- CreateIndex
CREATE INDEX "carts_orgId_idx" ON "carts"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_userId_orgId_key" ON "carts"("userId", "orgId");

-- CreateIndex
CREATE INDEX "negotiation_sessions_orgId_idx" ON "negotiation_sessions"("orgId");

-- CreateIndex
CREATE INDEX "orders_orgId_idx" ON "orders"("orgId");

-- AddForeignKey
ALTER TABLE "customer_org_members" ADD CONSTRAINT "customer_org_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_org_members" ADD CONSTRAINT "customer_org_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "customer_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_org_members" ADD CONSTRAINT "customer_org_members_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "customer_org_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_org_roles" ADD CONSTRAINT "customer_org_roles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "customer_orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_org_role_permissions" ADD CONSTRAINT "customer_org_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "customer_org_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_org_role_permissions" ADD CONSTRAINT "customer_org_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "customer_org_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_org_invites" ADD CONSTRAINT "customer_org_invites_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "customer_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_org_invites" ADD CONSTRAINT "customer_org_invites_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "customer_org_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE UNIQUE INDEX "carts_personal_per_user" ON "carts"("userId") WHERE "orgId" IS NULL;

INSERT INTO "customer_org_permissions" ("id", "key", "description") VALUES
  ('corgperm_view_org_cart',      'view_org_cart',       'View the organization''s shared cart'),
  ('corgperm_edit_org_cart',      'edit_org_cart',       'Add, update and remove items in the organization''s shared cart'),
  ('corgperm_place_order',        'place_order',         'Check out the organization''s cart and place orders on its behalf'),
  ('corgperm_view_order_history', 'view_order_history',  'View the organization''s shared order history'),
  ('corgperm_manage_negotiations','manage_negotiations', 'Start, view and respond to negotiations on the organization''s behalf'),
  ('corgperm_invite_members',     'invite_members',      'Invite new members to the organization'),
  ('corgperm_manage_roles',       'manage_roles',        'Create, edit and delete organization roles and their permissions'),
  ('corgperm_remove_members',     'remove_members',      'Remove members from the organization')
ON CONFLICT ("key") DO NOTHING;

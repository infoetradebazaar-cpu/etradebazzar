-- CreateEnum
CREATE TYPE "GstPanVerificationStatus" AS ENUM ('VERIFIED', 'FAILED', 'UNVERIFIED', 'SKIPPED');

-- AlterTable
ALTER TABLE "seller_kyc" ADD COLUMN     "gstVerificationMeta" JSONB,
ADD COLUMN     "gstVerificationStatus" "GstPanVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "gstVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "panVerificationMeta" JSONB,
ADD COLUMN     "panVerificationStatus" "GstPanVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "panVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "platform_role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "platform_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_role_permissions_roleId_permissionId_key" ON "platform_role_permissions"("roleId", "permissionId");

-- AddForeignKey
ALTER TABLE "platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "platform_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
